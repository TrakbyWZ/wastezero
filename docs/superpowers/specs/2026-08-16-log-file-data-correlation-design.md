# Log File Data Correlation — Design

Status: approved (pending implementation plan)
Related doc: `content/docs/data-correlation.md` (source requirement)
Branch: `feat/scheduled-file-processing`

## Problem

Each print job produces two uploaded log files:

- A **camera1** file (`log_file_header = 'Camera 1 Log File'`) listing every individual child bag code in sequence.
- A **camera2** file (`log_file_header = 'Camera 2 Log File'`) listing only the parent bag codes camera2 successfully read (with `Bad_Read` gaps where it missed).

Operations needs every camera1 (child) code attributed to the nearest camera2 (parent) code that is `>=` it in sequence — i.e. a "ceiling" match — so bags can be traced back to the parent case/pallet they belong to. Today nothing correlates the two files; `log_entries` stores both files' rows independently with no linkage between them.

## Scope

In scope: pairing camera1/camera2 files for the same job, computing the ceiling correlation, resolving each child code's owning customer/customer_sequence, persisting results with a full audit trail, running it on a schedule, and exposing results via a read API.

Out of scope (explicitly deferred): any UI/report page, CSV export, any change to the existing ingest path (`lib/log-ingest.ts`), and any change to `vw_customer_sequence_xref` or `customer_sequence_cam1_data_value_regex` itself (both are reused as-is, not modified). Also deferred: a separate staging/bigint-conversion table for the correlation join — considered, but correlation is already scoped to one job's rows at a time, so it isn't a demonstrated performance problem, and it would duplicate the audit/idempotency machinery `log_correlation_runs` already provides.

## Job identity

A "job" is identified by `(job_name, job_number, date_trunc('day', job_start_timestamp))` on `log_entries` — no new jobs table. A job is **ready to correlate** once `log_entries` has at least one row with each header (`'Camera 1 Log File'` and `'Camera 2 Log File'`) sharing that key. Camera1 and camera2 files are uploaded once, complete, after a print run finishes (not streamed incrementally), so "both headers present for the key" is a reliable completeness signal — no additional buffer/wait period is needed.

## Correlation algorithm

For each camera1 `log_entries` row in a ready job:

1. Parse `data_value` into `(prefix, numeric)` via regex on the trailing digit run (e.g. `R005C0000177` → prefix `R005C`, numeric `177`).
2. Among camera2 rows in the same job with matching `prefix` and `data_value <> 'Bad_Read'`, find the row with the smallest `numeric` value that is `>= ` the camera1 row's `numeric` value.
3. If found, that camera2 row is the resolved parent (`ParentEV`). If not found (trailing child codes past the last parent camera2 ever read), the parent is left **unresolved** (`parent_log_entry_id = null`) — never dropped, never clamped to the last known parent.
4. Resolve the child's owning `customer_sequence` by reusing the existing `public.customer_sequence_cam1_data_value_regex(label_prefix, number_format)` function exactly as `vw_customer_sequence_xref` does: `child_code ~ customer_sequence_cam1_data_value_regex(cs.label_prefix, cs.number_format)`. If no `customer_sequence` row matches, `customer_id`/`customer_sequence_id` are left null (unresolved, same posture as an unresolved parent). If more than one row matches (a pre-existing ambiguity risk in the regex approach, not introduced by this feature), pick deterministically — `is_default desc, id asc` — rather than erroring.

This mirrors the range-bucketing shape of `vw_customer_sequence_xref` (which uses `LAG()` over timestamps within one file) but buckets by **parsed numeric sequence value across two files** instead; the customer resolution in step 4 reuses that view's matching function directly.

## Storage

### `log_correlations`

One row per camera1 `log_entries` row. `child_log_entry_id`/`parent_log_entry_id` are kept for audit lineage (joining back to `log_entries`/`log_files` for operator/filename when needed), but the values a QC query actually filters/sorts/reads by — the codes, their timestamps, and the job join keys — are denormalized directly onto the row so the common QC read path never has to join at all.

| column | type | notes |
|---|---|---|
| `id` | `uuid pk` | |
| `child_log_entry_id` | `uuid fk -> log_entries.id` | **unique** — the upsert key; one row per camera1 entry |
| `parent_log_entry_id` | `uuid fk -> log_entries.id`, nullable | null = unresolved |
| `child_code` | `text` | denormalized `log_entries.data_value` for the child |
| `parent_code` | `text`, nullable | denormalized `log_entries.data_value` for the resolved parent; null = unresolved |
| `child_code_timestamp` | `timestamptz` | denormalized `log_entries.data_timestamp` for the child |
| `parent_code_timestamp` | `timestamptz`, nullable | denormalized `log_entries.data_timestamp` for the resolved parent |
| `job_name` | `text` | join key used to pair this row's job |
| `job_number` | `text` | join key used to pair this row's job |
| `job_date` | `date` | join key used to pair this row's job (`date_trunc('day', job_start_timestamp)`) |
| `customer_id` | `uuid fk -> customer.id`, nullable | resolved from `child_code`; null = unresolved |
| `customer_sequence_id` | `uuid fk -> customer_sequence.id`, nullable | resolved from `child_code`; null = unresolved |
| `created_timestamp` | `timestamptz` | |
| `created_by` | `uuid fk -> log_correlation_runs.id` | which run first created this row |
| `modified_timestamp` | `timestamptz` | |
| `modified_by` | `uuid fk -> log_correlation_runs.id` | which run last changed this row's parent/customer fields |

Indexes on `(job_name, job_number, job_date)`, `child_code`/`parent_code`, and `customer_id` support the QC query patterns directly against this table.

Upsert semantics: `ON CONFLICT (child_log_entry_id) DO UPDATE SET parent_log_entry_id = excluded.parent_log_entry_id, parent_code = excluded.parent_code, parent_code_timestamp = excluded.parent_code_timestamp, customer_id = excluded.customer_id, customer_sequence_id = excluded.customer_sequence_id, modified_timestamp = now(), modified_by = <this run's id>` — but only when the resolved parent or customer linkage actually differs from what's stored, so `modified_timestamp` stays a meaningful "this changed on rerun" signal rather than updating on every no-op sweep. Re-resolving customer linkage on every rerun (rather than only at insert time) matters because `customer_sequence.label_prefix`/`number_format` can be edited after the fact — a later sweep should pick up that drift. `child_code`/`child_code_timestamp`/job keys never change after insert, since they're keyed off the immutable `child_log_entry_id`.

### `log_correlation_runs`

Audit log of every execution of the correlation process — both scheduled sweeps and any future manual/scoped rerun, since both go through the same function.

| column | type | notes |
|---|---|---|
| `id` | `uuid pk` | |
| `run_started_at` | `timestamptz` | |
| `run_completed_at` | `timestamptz`, nullable | null while running |
| `triggered_by` | `text` | e.g. `'cron'`, or `'manual:<email>'` for a future manual rerun |
| `job_name_param` | `text`, nullable | scope this run was invoked with; null = unscoped |
| `job_number_param` | `text`, nullable | |
| `job_date_param` | `date`, nullable | |
| `rows_inserted` | `int` | |
| `rows_updated` | `int` | |
| `rows_unresolved` | `int` | rows written this run with `parent_log_entry_id is null` |
| `status` | `text` | `running` / `succeeded` / `failed` |
| `error_message` | `text`, nullable | |

## Processing function

`run_log_correlation(p_job_name text default null, p_job_number text default null, p_job_date date default null)` — `plpgsql`, defined in a migration:

1. Insert a `log_correlation_runs` row (`status = 'running'`, captures the three params, `triggered_by` passed in or defaulted).
2. Find ready job keys — if params are non-null, scope to that single job; if all null, sweep every ready job key that has at least one camera1 entry not yet in `log_correlations` (this is what keeps a scheduled sweep cheap: already-correlated jobs are `NOT EXISTS`-filtered out, so a rerun only does work where something is actually new or changed).
3. Run the ceiling-join algorithm per job key, upsert into `log_correlations` as described above.
4. Update the run row: `run_completed_at`, `status = 'succeeded'`, and the three row-count stats. On any error, catch, set `status = 'failed'`, `error_message`, still set `run_completed_at`, re-raise.

## Scheduling

A migration registers a Supabase Cron (`pg_cron`) job:

```sql
select cron.schedule('run-log-correlation', '*/10 * * * *', $$select run_log_correlation()$$);
```

Runs unscoped (all nulls) every 10 minutes. No Next.js/API involvement in the sweep itself — pure SQL, consistent with `vw_customer_sequence_xref`'s existing SQL-first pattern and with migrations being the schema/logic source of truth.

## API exposure

`GET /api/log-correlations` (new route, session-authenticated like the existing `GET /api/log-files` routes), backed by a new `vw_api_log_correlations` view. The QC-relevant columns (`child_code`, `child_code_timestamp`, `parent_code`, `parent_code_timestamp`, `job_name`, `job_number`, `job_date`, `customer_id`, `customer_sequence_id`) read straight off `log_correlations` with no join; the view additionally joins `child_log_entry_id`/`parent_log_entry_id` back to `log_entries`/`log_files` to surface operator/filename, and `customer_id` to `customer` to surface `customer_num`/`customer_description` (same fields `vw_customer_sequence_xref` exposes) — none of that is denormalized onto the table itself. Supports `job_name`/`job_number`/`customer_id`/`from`/`to` filters analogous to the existing list route. Returns JSON only — no CSV export, no UI, in this pass.

## Testing

A SQL-level test (following the `scripts/test-log-parser.ts` standalone-script convention, no jest/vitest) that:

1. Seeds `log_files`/`log_entries` directly with the exact sample data from `content/docs/data-correlation.md` (the camera1 sequence 177–190 and camera2 sequence with `Bad_Read` gaps), plus a matching `customer`/`customer_sequence` row (`label_prefix = 'R005C'`, `number_format` = 7 digits) so customer resolution has something to match against.
2. Calls `run_log_correlation()`.
3. Asserts the resulting `log_correlations` rows match the doc's expected `Camera1Code,ParentEV` table exactly on both `child_code`/`parent_code` (the denormalized values) and `child_log_entry_id`/`parent_log_entry_id` (the fk lineage), including correct `Bad_Read` gap-skipping and the trailing-unresolved case if the sample is extended to exercise it; asserts every row resolves the seeded `customer_id`/`customer_sequence_id`.
4. Seeds one additional camera1 code that matches no `customer_sequence` row and asserts it correlates with `customer_id`/`customer_sequence_id` null, without affecting its `parent_code` resolution.
5. Reruns `run_log_correlation()` a second time with no new data and asserts no rows change (`modified_timestamp` untouched) — confirms idempotency.

## Explicitly deferred

- UI/report page for viewing correlations.
- CSV export matching the doc's "Final Expected Result" shape.
- Manual/scoped rerun trigger (the function supports it via params; no caller is built yet).
- Any handling for a job whose camera1/camera2 files use mismatched code prefixes (treated as unresolved via the prefix-match requirement in step 2 of the algorithm; not separately reported).
- A separate staging/bigint-conversion table ahead of correlation (see Scope) — excluded as premature given correlation's per-job scope.
- Any changes to `customer`/`customer_sequence` themselves, or to how `vw_customer_sequence_xref` resolves customer linkage — this feature only reuses the existing regex function against the same tables.
