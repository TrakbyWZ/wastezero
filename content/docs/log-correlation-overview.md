# Log Data Correlation — Overview

This page covers how camera1 (child bag code) log entries get correlated to their camera2 (parent) codes, and how that correlation gets tied back to a customer/customer_sequence. See [Manual Runs and Troubleshooting](./log-correlation-operations.md) for how to inspect or retrigger this yourself.

## The problem

Each print job uploads two log files:

- A **camera1** file (`log_entries.log_file_header = 'Camera 1 Log File'`) listing every individual child bag code in sequence.
- A **camera2** file (`log_entries.log_file_header = 'Camera 2 Log File'`) listing only the parent codes camera2 successfully read, with `Bad_Read` gaps where it missed.

`log_entries` stores both files' rows independently with no linkage between them. Correlation attributes every camera1 code to the nearest camera2 code that is `>=` it in sequence (a "ceiling" match), and resolves the child code's owning `customer_sequence`.

## Data model

**`log_correlations`** — one row per camera1 `log_entries` row:

- `child_log_entry_id` / `parent_log_entry_id` — FKs into `log_entries`. `child_log_entry_id` is unique; it's both the primary key of "what this row is about" and the upsert key.
- `child_code` / `parent_code`, `child_code_timestamp` / `parent_code_timestamp` — denormalized off `log_entries` so the common read path doesn't need a join. `parent_*` are `null` when unresolved.
- `job_name` / `job_number` / `job_date` — the job identity this row was matched under (see below). `job_name`/`job_number` are nullable — real production data frequently has a null `job_number`.
- `customer_id` / `customer_sequence_id` — resolved from `child_code`; `null` if no `customer_sequence` matches.
- `created_by` / `modified_by` — FKs into `log_correlation_runs`, so every row traces back to exactly which run wrote or last changed it.

**`log_correlation_runs`** — one row per execution of `run_log_correlation()`, scheduled or manual: `triggered_by`, `allow_reprocess`, `child_log_file_id_param`/`parent_log_file_id_param` (exactly what was passed in — the latter is the override, `null` if auto-resolve was used), `resolved_parent_log_file_id` (whichever camera2 file actually got used, regardless of source), and result counts (`rows_inserted`, `rows_updated`, `rows_unresolved`, `status`, `error_message`).

## Job identity, file scoping, and readiness

Correlation is always scoped to one specific camera1 **file** (`p_child_log_file_id`), not a job-key text match — `run_log_correlation()` requires it. A "job" is still `(job_name, job_number, job_date)` conceptually (derived from the columns already on `log_entries`, no separate jobs table), but it's only used to **find** the matching camera2 (parent) file:

- If `p_parent_log_file_id` is passed explicitly, that file is used directly — no job-identity lookup happens at all. This is the override, useful when job metadata is wrong/missing but you know which two files actually belong together.
- Otherwise, the parent is auto-resolved: the child file's own `job_name`/`job_number`/`job_date` (read from its own `log_entries` rows) is matched against every `Camera 2 Log File` row's job identity.
  - **Zero matches** → not ready yet. Succeeds with 0 rows (not an error) — the same posture as before.
  - **More than one match** → a data anomaly (e.g. two camera2 files accidentally sharing a job key). Recorded as a **failed** run rather than silently picking one — see [Manual Runs and Troubleshooting](./log-correlation-operations.md).

`job_name`/`job_number` are frequently `null` in real data, so this matching is null-safe throughout (not a plain `=`).

## The matching algorithm

Once a child file and its resolved parent file are known, **every** camera1 row in the child file gets a `log_correlations` row — including `Bad_Read`/empty ones. There's no upfront exclusion on the child side (unlike the parent side, where `Bad_Read`/empty rows are never valid ceiling-match targets): a bad camera1 read should still be visible as attempted-but-unresolved, not silently missing. `log_entries` and `log_correlations` row counts for a given child file should always match 1:1.

For each camera1 row in the child file:

1. Parse `data_value` into a prefix and trailing numeric run (e.g. `R005C0000177` → prefix `R005C`, numeric `177`).
2. Among camera2 rows **in the resolved parent file** with a matching prefix and `data_value <> 'Bad_Read'`, find the smallest numeric value `>=` the child's.
3. If found, that's the resolved parent. If not — a trailing child code past the last parent camera2 ever read, or the child itself was `Bad_Read`/empty (no prefix/number to match against) — the parent stays **unresolved** (`null`). Never dropped, never clamped to the last known parent.
4. Separately, resolve the child's `customer_sequence` by reusing `public.customer_sequence_cam1_data_value_regex(label_prefix, number_format)` — the same function `vw_customer_sequence_xref` uses. No match (including `Bad_Read`/empty, which never matches any regex) → `customer_id`/`customer_sequence_id` stay `null`.

Both resolutions are independent: a row can have a resolved parent with no customer match, or vice versa.

**Performance:** step 2 and the job-identity lookup above are both backed by partial indexes on `log_entries` (`log_entries_camera2_numeric_value_idx`, `log_entries_camera2_job_key_idx` — see `supabase/migrations/20260816120200_create_run_log_correlation.sql`). Without them, this is an unindexed per-child-row scan of every parent candidate — measured at 6+ minutes on a real ~20k-child/~10k-parent job pair before the indexes existed, ~3 seconds after. If you ever change the parsing expression (the regex, the UTC-pinned date cast, or the null-safe `coalesce` comparisons), the index definitions must change to match exactly, or Postgres silently stops using them.

## Scheduling

### What runs, and how often

A `pg_cron` job named `run-log-correlation` calls `select run_log_correlation_sweep();` every 10 minutes (`*/10 * * * *`). The sweep finds every camera1 file that (a) has a resolvable parent file and (b) still has at least one row with no `log_correlations` entry, and calls `run_log_correlation()` once per file, with every parameter at its default. That default call **only ever inserts rows for camera1 entries that have no `log_correlations` row yet**; it can never revise a row that's already been written, no matter what changes in the underlying data. A per-file failure doesn't stop the sweep from processing the rest. See [Manual Runs and Troubleshooting](./log-correlation-operations.md) for the one mechanism that can revise an existing row, and for how to inspect/pause/change the schedule.

### How the scheduling mechanism works

This is **`pg_cron`**, a Postgres extension — not Vercel Cron, not a Next.js API route, not anything external. It runs entirely inside the database as a background worker, so it works the same way locally and on hosted Supabase, and keeps running even if the Next.js app itself is down.

It's provisioned by `supabase/migrations/20260816120300_schedule_log_correlation_cron.sql`:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'run-log-correlation',
  '*/10 * * * *',
  $$select public.run_log_correlation_sweep()$$
);
```

A few things worth knowing about how this behaves:

- **`cron.schedule()` is registration, not migration-tracked state.** The job itself lives in the `cron.job` system table, not as a row this migration "owns" the way a table/function definition is. Calling `cron.schedule()` again with the same job name (`'run-log-correlation'`) **updates** the existing job in place rather than creating a duplicate — so re-running this migration (a full `supabase db reset`, or reapplying it) is always safe and idempotent.
- **Changing the schedule later requires a new migration** (this one is already applied — see the "never edit an applied migration" rule in the main `CLAUDE.md`). A new migration just calls `cron.schedule('run-log-correlation', '<new interval>', $$...$$)` again; no need to `cron.unschedule()` first, since it's an upsert by name.
- **`pg_cron` needs to be preloaded at the Postgres server level** (`shared_preload_libraries`) for the background worker to actually run, not just have its extension created. This was verified present on both local Supabase (`supabase start`) and is expected on hosted Supabase (Supabase's own "Supabase Cron" feature is built on the same extension) — but if the schedule ever silently stops working after a deploy, that's the first thing to check (see [Manual Runs and Troubleshooting](./log-correlation-operations.md)).

**Note:** `run_log_correlation()` never raises for expected failures (not-ready, ambiguous parent) or even genuinely unexpected errors — it always returns a run id and records the outcome on `log_correlation_runs`. Re-raising would abort the whole transaction and roll back the very audit row meant to record the failure, so callers check the returned run's `status`/`error_message` instead of relying on an RPC-level error.

## API

`GET /api/log-correlations` (session-authenticated, same pattern as `GET /api/log-files`) reads from `vw_api_log_correlations`, which joins `log_correlations` out to operator/filename (`log_entries`/`log_files`) and `customer_num`/`customer_description` (`customer`) for display. Supports `job_name`, `job_number`, `customer_id`, `from`, `to`, `page`, `page_size` query params.
