# Log Data Correlation — Overview

This page covers how camera1 (child bag code) log entries get correlated to their camera2 (parent) codes, and how that correlation gets tied back to a customer/customer_sequence. See [Manual Runs and Troubleshooting](./log-correlation-operations.md) for how to inspect or retrigger this yourself, and [Quality Control](#quality-control) below for the point-and-click UI over all of this.

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

A `pg_cron` job named `run-log-correlation` calls `select run_log_correlation_sweep();` every 10 minutes (`*/10 * * * *`). The sweep has two passes, both in one function call: first it finds every camera1 file that (a) has a resolvable parent file and (b) still has at least one row with no `log_correlations` entry, and calls `run_log_correlation()` once per file, with every parameter at its default. That default call **only ever inserts rows for camera1 entries that have no `log_correlations` row yet**; it can never revise a row that's already been written, no matter what changes in the underlying data. Second, it finds every child file with at least one untouched `Bad_Read`/blank placeholder row left and calls `fill_log_correlation_gaps()` once per file (see [Filling gaps](#filling-gaps) below) — so a file that's freshly correlated in the first pass can have its gaps filled in the very same tick. A file whose most recent `gap_fill` run made zero progress and whose rows haven't changed since is skipped (it's confirmed permanently stuck — see [Filling gaps](#filling-gaps)), so a file with no further automatic progress possible gets one confirming no-op run rather than one every tick forever. A per-file failure in either pass doesn't stop the sweep from processing the rest. See [Manual Runs and Troubleshooting](./log-correlation-operations.md) for the one mechanism that can revise an existing row, and for how to inspect/pause/change the schedule.

### How the scheduling mechanism works

This is **`pg_cron`**, a Postgres extension — not Vercel Cron, not a Next.js API route, not anything external. It runs entirely inside the database as a background worker, so it works the same way locally and on hosted Supabase, and keeps running even if the Next.js app itself is down.

It's provisioned by `supabase/migrations/20260816120300_schedule_log_correlation_cron.sql`:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'run-log-correlation',
  '*/10 * * * *',
  $$set statement_timeout = '10min'; select public.run_log_correlation_sweep()$$
);
```

A few things worth knowing about how this behaves:

- **`cron.schedule()` is registration, not migration-tracked state.** The job itself lives in the `cron.job` system table, not as a row this migration "owns" the way a table/function definition is. Calling `cron.schedule()` again with the same job name (`'run-log-correlation'`) **updates** the existing job in place rather than creating a duplicate — so re-running this migration (a full `supabase db reset`, or reapplying it) is always safe and idempotent.
- **Changing the schedule later requires a new migration** (this one is already applied — see the "never edit an applied migration" rule in the main `CLAUDE.md`). A new migration just calls `cron.schedule('run-log-correlation', '<new interval>', $$...$$)` again; no need to `cron.unschedule()` first, since it's an upsert by name.
- **`pg_cron` needs to be preloaded at the Postgres server level** (`shared_preload_libraries`) for the background worker to actually run, not just have its extension created. This was verified present on both local Supabase (`supabase start`) and is expected on hosted Supabase (Supabase's own "Supabase Cron" feature is built on the same extension) — but if the schedule ever silently stops working after a deploy, that's the first thing to check (see [Manual Runs and Troubleshooting](./log-correlation-operations.md)).
- **The job's command carries its own `statement_timeout`, scoped to just this job** (`supabase/migrations/20261012180754_raise_statement_timeout_for_log_correlation_cron.sql`), raised from the default 2min to 10min. This was added after the very first production deploy: with every pre-existing file simultaneously "pending" for a brand-new feature, the sweep's first few ticks exceeded 2min and got cancelled — see the **Note** below for why that's worse than an ordinary failure. Scoping the raise to the job's own command (rather than the `postgres` role or database) keeps the normal 2min guard everywhere else (Studio SQL editor, other admin queries).

**Note:** `run_log_correlation()` never raises for expected failures (not-ready, ambiguous parent) or even genuinely unexpected errors — it always returns a run id and records the outcome on `log_correlation_runs`. Re-raising would abort the whole transaction and roll back the very audit row meant to record the failure, so callers check the returned run's `status`/`error_message` instead of relying on an RPC-level error. A `statement_timeout` cancellation is the one failure mode this can't protect against: it's a hard query cancellation the function's exception handling never gets a chance to catch, so it aborts the whole call (including, for the sweep, every file batched into that invocation) with no audit row at all — `log_correlation_runs` stays completely silent about it. `cron.job_run_details.return_message` is the only place the actual `canceling statement due to statement timeout` error shows up (see [Manual Runs and Troubleshooting](./log-correlation-operations.md#checking-the-schedule-itself)). If the sweep ever goes quiet again despite `cron.job` showing it as active, check there first.

## Filling gaps

`run_log_correlation()` records every camera1 row as-is, including `Bad_Read`/blank reads it can't resolve a parent for. Some of those are genuine data-quality gaps where the surrounding sequence tells us, with confidence, which number is actually missing — e.g. `..., 177, Bad_Read, 179, ...` almost certainly means `178`. `fill_log_correlation_gaps(p_child_log_file_id, p_triggered_by, p_allow_refill, p_max_gap_span)` fills exactly those, and only those.

Two distinct shapes, both found by the same walk over a child file's already-correlated rows in physical (`log_entries.sort_order`) order:

- **Gap type A — a placeholder row physically exists.** A `Bad_Read`/blank row sits between two good reads (`177, Bad_Read, 179`). Its `usr_child_code` is set to the inferred value; the row itself (`child_log_entry_id`, `child_code`, etc.) is untouched.
- **Gap type B — no row exists at all.** The camera1 sequence itself skips a number (`177, 179` with nothing physically between them). A synthetic row is inserted with `is_inferred = true`, `child_log_entry_id`/`child_code`/`child_code_timestamp` all `null` (the only rows allowed to have those null — see `log_correlations_inferred_or_real_check`), and `usr_child_code` set to the inferred value.

A gap is only filled when it's unambiguous: the count of placeholder rows physically occupying the span must exactly equal the numeric span (missing-count). Anything else is left alone and counted in the run's `rows_unresolved`:

- **Leading/trailing gaps** — a placeholder with no bound on one side — are never filled (nothing to infer from).
- **A prefix change** between the two bounding codes is never bridged (e.g. `R005C...` to `ZZZZZ...` — different `customer_sequence` label prefixes, not a sequence gap).
- **Partially-placeholdered gaps** — some but not all of the missing numbers have a physical placeholder row — are skipped entirely rather than guessed at (e.g. 2 numbers missing but only 1 placeholder row present).
- **Gaps wider than `p_max_gap_span`** (default 1000) are skipped regardless of whether the placeholder count would otherwise match — a safety cap so one anomalous pair of bounds can't synthesize an unbounded number of inferred rows in one run.

Within an otherwise-fillable gap type A span, a row a human has already excluded (`usr_exclude_row = true`) or already touched (`overridden_by` set, unless `p_allow_refill` is `true`) still occupies its slot in the numbering, but is left untouched rather than overwritten — its slot does not get a type-B insert either, since it's not actually empty.

For every code it fills or inserts, `fill_log_correlation_gaps()` also writes `usr_parent_code` via the same ceiling-match `run_log_correlation()` uses, against whichever camera2 file the correlation pass already resolved for that child file (found from an already-resolved row's real parent linkage, not from `log_correlation_runs`). If nothing in the file has resolved a parent yet, `usr_parent_code` is left `null` rather than guessed. It does not attempt customer resolution — `customer_id`/`customer_sequence_id` are only ever written by `run_log_correlation()` itself.

Like `run_log_correlation()`, it never raises for expected or unexpected failures — it always returns a run id and records the outcome on `log_correlation_runs` (tagged `operation = 'gap_fill'`, distinguishing it from `operation = 'correlate'` rows). `rows_inserted` counts type B rows, `rows_updated` counts type A corrections, `rows_unresolved` counts gaps skipped as ambiguous or too wide.

**Why a stuck file doesn't flood the audit log:** a file with a permanently-unresolvable gap (leading/trailing, ambiguous, too wide, or a prefix change) matches the same "has a pending placeholder" check forever — nothing about it ever changes on its own. `run_log_correlation_sweep()`'s gap-fill pass accounts for this: it skips a file whose most recent `gap_fill` run already made zero progress (`rows_inserted = 0` and `rows_updated = 0`) with nothing changed since (no row's `modified_timestamp` newer than that run's `run_completed_at`), so such a file gets exactly one confirming no-op run rather than a new one every 10 minutes forever. This throttle only applies to the automatic sweep — `fill_log_correlation_gaps()` itself has no memory of past attempts and can always be called directly for any file (see [Manual Runs and Troubleshooting](./log-correlation-operations.md)), and once anything in the file's rows changes (a manual `p_allow_refill := true` call that touches a row, or a future QC correction), the sweep picks it back up on its own.

## API

`GET /api/log-correlations` (session-authenticated, same pattern as `GET /api/log-files`) reads from `vw_api_log_correlations`, which joins `log_correlations` out to operator/filename (`log_entries`/`log_files`) and `customer_num`/`customer_description` (`customer`) for display. Supports `job_name`, `job_number`, `customer_id`, `child_log_file_id`, `status` (`unresolved`/`excluded`/`inferred`), `from`, `to`, `page`, `page_size` query params, and returns an exact `total_count`/`total_pages` (`{ count: "exact" }`) so the UI can build a real page-number control rather than Previous/Next-only. The view's `child_entry`/`child_file` joins are `left` (not `inner`) so `is_inferred` rows — which have no backing `log_entries` row — still show up. `effective_child_code`/`effective_parent_code` expose `coalesce(usr_*, *)` so callers get "the code we actually believe" (algorithm output, or a correction/fill) without repeating that logic themselves. When scoped to one `child_log_file_id` (the Quality Control detail screen), the route sorts by `child_sort_order` (physical read order) instead of `effective_child_code`, since that's the order a human reviewing the file actually wants; inferred rows (no `child_sort_order`) sort last.

Other routes built for Quality Control:

- **`GET /api/log-correlation-files`** — reads `vw_api_log_correlation_files`, one row per child file with job/customer identity, row-status counts (`total_count`/`unresolved_count`/`excluded_count`/`inferred_count`), and the latest correlate/gap-fill run's status — backs the QC list screen. Supports `job_name`, `job_number`, `customer_id`, `child_log_file_id`, `from`, `to`, `needs_attention` (shorthand for `unresolved_count > 0 or excluded_count > 0`), `page`, `page_size`; also returns exact `total_count`/`total_pages`.
- **`GET /api/log-correlation-runs`** — reads `vw_api_log_correlation_runs` (same shape as `log_correlation_runs`, with filenames joined in), filtered by `child_log_file_id` — backs the QC detail screen's run history table.
- **`PATCH /api/log-correlations/[id]`** — the only write path into `log_correlations` outside the correlate/gap-fill functions themselves. Accepts any of `usr_child_code`, `usr_parent_code`, `usr_exclude_row`, `notes`; stamps `overridden_by`/`overridden_at` with the signed-in user's email and the current time. This is how a human correction differs from an automated one: `created_by`/`modified_by` always point at a `log_correlation_runs` row, while `overridden_by` is a plain email string set only by this route.
- **`POST /api/log-files/[id]/recorrelate`** / **`POST /api/log-files/[id]/refill-gaps`** — call `run_log_correlation()` / `fill_log_correlation_gaps()` for one file with `p_allow_reprocess`/`p_allow_refill := true` and `p_triggered_by := 'manual:<email>'`, the same manual-retrigger pattern documented in [Manual Runs and Troubleshooting](./log-correlation-operations.md#manually-retriggering-a-run), just reachable from the UI instead of SQL.
- **`GET /api/log-files/[id]/export`** — the customer-facing CSV download; see [Quality Control](#quality-control) below.

## Quality Control

`/protected/quality-control` is the UI over everything on this page — finding a file, reading its correlation/gap-fill results, fixing what the algorithm couldn't resolve, and producing the customer-facing report. It superseded the old "Reports → Customer Reports" (Customer Bags) page, which read from a now-dropped `report_customer_bags` table/refresh-function pair (`supabase/migrations/20261006120200_drop_report_customer_bags.sql`).

**List screen** — filter files by customer, job name/number, date range, or "needs attention only" (any unresolved or excluded row); each row shows total/unresolved/excluded counts and the latest correlate/gap-fill run's status, with a link into that file's detail screen.

**Detail screen**, for one `child_log_file_id`:

- **Header** — the file's most recent run id (not the file's own id) as the page title, plus a Child File / Parent File / Customer / Job identity strip sourced independently of the row-status filter (so it's always populated even when a filter matches zero rows).
- **Run history** — every `log_correlation_runs` row for this file (`operation`, `triggered_by`, `status`, row counts, resolved parent file), with **Re-correlate** / **Re-run gap-fill** buttons that call the manual-retrigger API routes above.
- **Row table** — every `log_correlations` row for the file, filterable by status (all/unresolved/excluded/inferred), sorted in physical read order (`Seq` = `child_sort_order`, blank for inferred rows — there's no backing `log_entries` row to pull a position from). Each row can be edited inline (child code, parent code, exclude + notes via the `PATCH` route above) and has an info (ⓘ) button that reveals the row's raw `log_correlations.id` with one-click copy, for pulling up the exact record in SQL when troubleshooting (join it back to the run that wrote it via `created_by`/`modified_by` — see [Manual Runs and Troubleshooting](./log-correlation-operations.md#checking-recent-runs)).
- Both screens' tables use a bounded, independently-scrolling region (`max-h-[70vh] overflow-auto`) with a sticky header row and a real page-number dropdown (built from the API's exact `total_count`), rather than open-ended Previous/Next.

### Customer-facing export (`GET /api/log-files/[id]/export`)

Produces one CSV per child file, matching the shape of the legacy "Caspio Download" report exactly — same column names/order (`Camera1, C1EV, ParentEV, Date, Time, ParentTime, Camera2, Job Name, Job Number, Operator`) and the same date/time formatting (`M/D/YYYY`, `h:mm:ss AM/PM`, and `M/D/YYYY H:mm` for `ParentTime` — all the timestamp's raw UTC clock value, deliberately **not** converted to any timezone, matching what the legacy report always did). Filename: `{child filename}_CORR_RPT_{yyyyMMdd}_{HHmmss}.csv`, timestamped at export time (UTC).

This is a customer deliverable, not a developer dump, so it differs from the row table / `GET /api/log-correlations` in two important ways:

- **`usr_exclude_row` rows are dropped entirely.** An exclusion is an internal QC decision — the customer should never see that a row existed and was removed.
- **`C1EV`/`ParentEV` show the effective (corrected) code, and `Camera1`/`Camera2` show the raw scan as-is** (including literal `Bad_Read` text) — the customer sees both "what was scanned" and "what we determined it actually was," but never a flag saying a human or the gap-fill algorithm touched it.

One backfill the export does that the row table doesn't need to: `run_log_correlation()` doesn't link `parent_log_entry_id` (so `parent_code`/`parent_code_timestamp` stay `null`) when the **child** read itself was `Bad_Read` — it only sets `usr_parent_code` as a best-effort ceiling match, without the underlying raw parent entry. The legacy report never left `Camera2`/`ParentTime` blank in this situation, so the export route looks up the real parent entry directly (by the file's resolved parent file + matching `data_value`) to backfill those two columns for just the affected rows, rather than changing `run_log_correlation()`'s core linking behavior.
