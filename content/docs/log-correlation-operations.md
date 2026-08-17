# Log Data Correlation — Manual Runs and Troubleshooting

This page covers how to inspect what the correlation sweep has done, and how to manually retrigger it. See [Overview and Architecture](./log-correlation-overview.md) for how the matching algorithm and data model work.

There is no UI or API trigger for this yet — everything here runs as SQL, either in the Supabase Studio SQL editor or `psql` against the target database.

## Checking recent runs

Every execution of `run_log_correlation()` — scheduled or manual — is logged. It never raises for a failure (see below), so this table, not an RPC-level error, is the source of truth for whether a given run actually succeeded:

```sql
select id, run_started_at, run_completed_at, triggered_by, allow_reprocess,
       child_log_file_id_param, parent_log_file_id_param, resolved_parent_log_file_id,
       rows_inserted, rows_updated, rows_unresolved, status, error_message
from log_correlation_runs
order by run_started_at desc
limit 20;
```

`status = 'failed'` rows have `error_message` populated. `triggered_by = 'cron'` is the scheduled sweep; anything else is a manual invocation (see below). `resolved_parent_log_file_id` tells you which camera2 file actually got used, whether it was auto-resolved or came from `parent_log_file_id_param` (the override).

## Checking the schedule itself

`log_correlation_runs` only records runs that actually started executing `run_log_correlation_sweep()` — it says nothing about whether `pg_cron` is actually invoking it on schedule. To check the scheduler itself:

```sql
-- Is the job registered, and with what schedule?
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'run-log-correlation';

-- Did it actually fire, and did each invocation succeed at the SQL level?
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'run-log-correlation')
order by start_time desc
limit 20;
```

`cron.job_run_details.status` reflects whether the SQL command itself errored (it shouldn't — `run_log_correlation_sweep()` doesn't raise); `log_correlation_runs` is where you look for whether the *correlation work itself* succeeded per file. See [Overview](./log-correlation-overview.md#how-the-scheduling-mechanism-works) for how the schedule is provisioned and how to change it.

## Finding unresolved rows

Rows with `parent_code is null` have a camera1 code with no matching camera2 parent (yet, or ever, if that job's camera2 file is genuinely missing that read). Rows with `customer_id is null` have a code that doesn't match any `customer_sequence`'s `label_prefix`/`number_format`.

```sql
select job_name, job_number, job_date, child_code, parent_code, customer_id
from log_correlations
where job_name = 'YourJobName'
order by child_code;
```

## Manually retriggering a run

`run_log_correlation()` takes five parameters — only the first is required:

```sql
run_log_correlation(
  p_child_log_file_id uuid,
  p_parent_log_file_id uuid default null,
  p_triggered_by text default 'cron',
  p_allow_reprocess boolean default false
)
```

- **`p_child_log_file_id` is the camera1 (child) file to correlate.** There's no "process everything" unscoped mode for this function directly — that's what `run_log_correlation_sweep()` is for (see below).
- **`p_parent_log_file_id`** overrides auto-resolution — pass the camera2 file's `log_files.id` directly when you already know which two files go together (e.g. job metadata is wrong or missing). Leave it `null` to auto-resolve from the child file's own `job_name`/`job_number`/`job_date`.
- **`p_allow_reprocess` is the important one.** Default `false` (what the scheduled sweep always uses) means the run can only insert brand-new rows — it will never touch a `log_correlations` row that already exists. Pass `true` to let it revise already-correlated rows (e.g. after fixing a bad `customer_sequence.label_prefix`, or discovering the parent file was wrong).
- Always set `p_triggered_by` to something identifiable (e.g. `'manual:you@example.com'`) when running manually, so `log_correlation_runs` reflects who/what ran it.

### Find a file's id

```sql
select id from log_files where filename = 'the-filename.txt';
```

### Retrigger one specific file, auto-resolving the parent

```sql
select run_log_correlation(
  p_child_log_file_id := (select id from log_files where filename = 'evergreen0416__c.csv'),
  p_triggered_by := 'manual:you@example.com',
  p_allow_reprocess := true
);
```

### Retrigger one specific file, with an explicit parent override

```sql
select run_log_correlation(
  p_child_log_file_id := (select id from log_files where filename = 'evergreen0416__c.csv'),
  p_parent_log_file_id := (select id from log_files where filename = 'evergreen0416__p.csv'),
  p_triggered_by := 'manual:you@example.com',
  p_allow_reprocess := true
);
```

### Retrigger everything pending

```sql
select * from run_log_correlation_sweep('manual:you@example.com');
```

This is the same function the `pg_cron` schedule calls — it finds every camera1 file with a resolvable parent and pending unprocessed rows, and calls `run_log_correlation()` once per file (insert-only, same as the schedule). Running it manually just runs it immediately instead of waiting for the next 10-minute tick, and attributes the resulting `log_correlation_runs` rows to you instead of `'cron'`. It returns one run id per file it touched.

### Reprocess a batch of files (use sparingly)

There's no single "reprocess everything" call — `p_allow_reprocess` only applies per-file via `run_log_correlation()` directly. To reprocess several files (e.g. after a `customer_sequence` correction that could affect many jobs), loop over them explicitly:

```sql
select run_log_correlation(p_child_log_file_id := id, p_triggered_by := 'manual:you@example.com', p_allow_reprocess := true)
from log_files
where filename like 'evergreen%__c.csv';
```

Each call re-runs the full matching algorithm for that file, so scope this to only the files you actually need revised.

### Pausing the schedule during heavy manual work

If you're doing a large manual backfill or reprocessing pass and don't want the cron sweep firing concurrently and racing your own work:

```sql
select cron.unschedule('run-log-correlation');
-- ... do your manual work ...
select cron.schedule('run-log-correlation', '*/10 * * * *', $$select public.run_log_correlation_sweep()$$);
```

(This only affects the running database — it does not change the migration, so a future `supabase db reset`/deploy restores the schedule regardless.)

## Troubleshooting quick checks

- **A file never gets picked up by the sweep:** confirm a matching `Camera 2 Log File` exists in `log_entries` sharing that child file's `job_name`/`job_number`/day — a child file with no resolvable parent is never "ready" (see [Overview](./log-correlation-overview.md#job-identity-file-scoping-and-readiness)). Check by calling `run_log_correlation()` directly for that file and looking at `resolved_parent_log_file_id` on the resulting run row (`null` = not ready).
- **A run has `status = 'failed'` with an "Ambiguous parent file" error:** more than one `Camera 2 Log File` shares that job identity. Either fix the underlying job metadata, or call `run_log_correlation()` again with an explicit `p_parent_log_file_id` override to bypass the ambiguity.
- **A row exists but `customer_id` is null:** the `customer_sequence.label_prefix`/`number_format` for that customer doesn't match the code's format via `customer_sequence_cam1_data_value_regex`. Fixing the `customer_sequence` row does not retroactively fix existing `log_correlations` rows — you must reprocess that file with `p_allow_reprocess := true`.
- **Rerunning doesn't seem to change anything:** that's expected for the default (`p_allow_reprocess = false`) path — it's insert-only by design. You need `p_allow_reprocess := true` to revise existing rows.
- **A correlation run is much slower than expected:** the ceiling-match and job-identity queries depend on two partial indexes on `log_entries` (`log_entries_camera2_numeric_value_idx`, `log_entries_camera2_job_key_idx`). If a migration ever changes the parsing/matching expressions without updating these indexes to match exactly, Postgres silently falls back to an unindexed scan — `explain` the query and check for a Seq Scan / Bitmap Heap Scan without an Index Cond where you'd expect one. See [Overview](./log-correlation-overview.md#the-matching-algorithm) for the exact expressions that must match.
- **`pg_cron` job not running:** check `select * from cron.job where jobname = 'run-log-correlation';` and `select * from cron.job_run_details order by start_time desc limit 10;` for scheduler-level failures (separate from `log_correlation_runs`, which only records runs that actually started executing `run_log_correlation()`).
