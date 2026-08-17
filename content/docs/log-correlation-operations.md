# Log Data Correlation — Manual Runs and Troubleshooting

This page covers how to inspect what the correlation sweep has done, and how to manually retrigger it. See [Overview and Architecture](./log-correlation-overview.md) for how the matching algorithm and data model work.

There is no UI or API trigger for this yet — everything here runs as SQL, either in the Supabase Studio SQL editor or `psql` against the target database.

## Checking recent runs

Every execution of `run_log_correlation()` — scheduled or manual — is logged:

```sql
select id, run_started_at, run_completed_at, triggered_by, allow_reprocess,
       job_name_param, job_number_param, job_date_param,
       rows_inserted, rows_updated, rows_unresolved, status, error_message
from log_correlation_runs
order by run_started_at desc
limit 20;
```

`status = 'failed'` rows have `error_message` populated. `triggered_by = 'cron'` is the scheduled sweep; anything else is a manual invocation (see below).

## Finding unresolved rows

Rows with `parent_code is null` have a camera1 code with no matching camera2 parent (yet, or ever, if that job's camera2 file is genuinely missing that read). Rows with `customer_id is null` have a code that doesn't match any `customer_sequence`'s `label_prefix`/`number_format`.

```sql
select job_name, job_number, job_date, child_code, parent_code, customer_id
from log_correlations
where job_name = 'YourJobName'
order by child_code;
```

## Manually retriggering a run

`run_log_correlation()` takes five parameters, all optional:

```sql
run_log_correlation(
  p_job_name text default null,
  p_job_number text default null,
  p_job_date date default null,
  p_triggered_by text default 'cron',
  p_allow_reprocess boolean default false
)
```

- Leaving `p_job_name`/`p_job_number`/`p_job_date` as `null` processes every ready job with pending work; passing all three scopes the run to one specific job.
- **`p_allow_reprocess` is the important one.** Default `false` (what the scheduled sweep always uses) means the run can only insert brand-new rows — it will never touch a `log_correlations` row that already exists. Pass `true` to let it revise already-correlated rows (e.g. after fixing a bad `customer_sequence.label_prefix`, or backfilling a camera2 file that arrived late).
- Always set `p_triggered_by` to something identifiable (e.g. `'manual:you@example.com'`) when running manually, so `log_correlation_runs` reflects who/what ran it.

### Retrigger one specific job

First, find the job's key (skip this if you already know `job_name`/`job_number`/`job_date`):

```sql
select distinct job_name, job_number, date_trunc('day', job_start_timestamp)::date as job_date
from log_entries
where log_file_id = (select id from log_files where filename = 'the-filename.txt');
```

Then run it, with `p_allow_reprocess := true` if this job may already have `log_correlations` rows you want revised:

```sql
select run_log_correlation(
  p_job_name := 'Evergreen0416',
  p_job_number := 'EVG-0416',
  p_job_date := '2026-04-16',
  p_triggered_by := 'manual:you@example.com',
  p_allow_reprocess := true
);
```

### Retrigger everything pending

```sql
select run_log_correlation(p_triggered_by := 'manual:you@example.com');
```

This behaves exactly like the scheduled sweep (insert-only, unscoped) except it runs immediately instead of waiting for the next 10-minute tick, and it's attributed to you in `log_correlation_runs` instead of `'cron'`.

### Reprocess everything (use sparingly)

```sql
select run_log_correlation(p_triggered_by := 'manual:you@example.com', p_allow_reprocess := true);
```

Scans and potentially updates every already-correlated row across every job, not just one — reasonable after a config fix that could affect many jobs (e.g. a `customer_sequence` correction), but re-runs the full matching algorithm for every job in the table.

## Troubleshooting quick checks

- **A job never gets picked up:** confirm both a `Camera 1 Log File` and `Camera 2 Log File` row exist in `log_entries` for that `job_name`/`job_number`/day — a job with only one file present is never "ready" (see [Overview](./log-correlation-overview.md#job-identity-and-readiness)).
- **A row exists but `customer_id` is null:** the `customer_sequence.label_prefix`/`number_format` for that customer doesn't match the code's format via `customer_sequence_cam1_data_value_regex`. Fixing the `customer_sequence` row does not retroactively fix existing `log_correlations` rows — you must reprocess (see above).
- **Rerunning doesn't seem to change anything:** that's expected for the default (`p_allow_reprocess = false`) path — it's insert-only by design. You need `p_allow_reprocess := true` to revise existing rows.
- **`pg_cron` job not running:** check `select * from cron.job where jobname = 'run-log-correlation';` and `select * from cron.job_run_details order by start_time desc limit 10;` for scheduler-level failures (separate from `log_correlation_runs`, which only records runs that actually started executing `run_log_correlation()`).
