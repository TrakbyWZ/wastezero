-- Audit log of every run_log_correlation() execution (scheduled sweep or
-- manual reprocess), capturing the parameters it was invoked with.
create table public.log_correlation_runs (
  id uuid not null default gen_random_uuid(),
  run_started_at timestamp with time zone not null default now(),
  run_completed_at timestamp with time zone null,
  triggered_by text not null default 'cron',
  allow_reprocess boolean not null default false,
  job_name_param text null,
  job_number_param text null,
  job_date_param date null,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_unresolved integer not null default 0,
  status text not null default 'running',
  error_message text null,
  constraint log_correlation_runs_pkey primary key (id),
  constraint log_correlation_runs_status_check check (status in ('running', 'succeeded', 'failed'))
);

comment on table public.log_correlation_runs is
  'Audit log of every run_log_correlation() execution (scheduled sweep or manual reprocess). allow_reprocess is always false for the scheduled cron call.';
