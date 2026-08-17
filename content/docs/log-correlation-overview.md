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
- `job_name` / `job_number` / `job_date` — the job identity this row was matched under (see below).
- `customer_id` / `customer_sequence_id` — resolved from `child_code`; `null` if no `customer_sequence` matches.
- `created_by` / `modified_by` — FKs into `log_correlation_runs`, so every row traces back to exactly which run wrote or last changed it.

**`log_correlation_runs`** — one row per execution of `run_log_correlation()`, scheduled or manual: `triggered_by`, `allow_reprocess`, the scoping params it was called with, and result counts (`rows_inserted`, `rows_updated`, `rows_unresolved`).

## Job identity and readiness

A "job" is `(job_name, job_number, date_trunc('day', job_start_timestamp))` — there's no separate jobs table; it's derived from the same columns already on `log_entries`. A job is ready to correlate once `log_entries` has at least one row with each header (`Camera 1 Log File` and `Camera 2 Log File`) sharing that key. Camera1/camera2 files are uploaded once, complete, after a print run finishes, so "both headers present" is a reliable completeness signal.

## The matching algorithm

For each camera1 row in a ready job:

1. Parse `data_value` into a prefix and trailing numeric run (e.g. `R005C0000177` → prefix `R005C`, numeric `177`).
2. Among camera2 rows in the same job with a matching prefix and `data_value <> 'Bad_Read'`, find the smallest numeric value `>=` the child's.
3. If found, that's the resolved parent. If not (a trailing child code past the last parent camera2 ever read), the parent stays **unresolved** (`null`) — never dropped, never clamped to the last known parent.
4. Separately, resolve the child's `customer_sequence` by reusing `public.customer_sequence_cam1_data_value_regex(label_prefix, number_format)` — the same function `vw_customer_sequence_xref` uses. No match → `customer_id`/`customer_sequence_id` stay `null`.

Both resolutions are independent: a row can have a resolved parent with no customer match, or vice versa.

## Scheduling

A `pg_cron` job (`run-log-correlation`, registered in `supabase/migrations/20260816120300_schedule_log_correlation_cron.sql`) calls `select run_log_correlation();` every 10 minutes — unscoped, with every parameter at its default. That default call **only ever inserts rows for camera1 entries that have no `log_correlations` row yet**; it can never revise a row that's already been written, no matter what changes in the underlying data. See [Manual Runs and Troubleshooting](./log-correlation-operations.md) for the one mechanism that can revise an existing row.

## API

`GET /api/log-correlations` (session-authenticated, same pattern as `GET /api/log-files`) reads from `vw_api_log_correlations`, which joins `log_correlations` out to operator/filename (`log_entries`/`log_files`) and `customer_num`/`customer_description` (`customer`) for display. Supports `job_name`, `job_number`, `customer_id`, `from`, `to`, `page`, `page_size` query params.
