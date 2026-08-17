-- Audit log of every run_log_correlation() execution (scheduled sweep or
-- manual reprocess), capturing the parameters it was invoked with.
create table public.log_correlation_runs (
  id uuid not null default gen_random_uuid(),
  run_started_at timestamp with time zone not null default now(),
  run_completed_at timestamp with time zone null,
  triggered_by text not null default 'cron',
  allow_reprocess boolean not null default false,
  child_log_file_id_param uuid not null,
  parent_log_file_id_param uuid null,
  resolved_parent_log_file_id uuid null,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_unresolved integer not null default 0,
  status text not null default 'running',
  error_message text null,
  constraint log_correlation_runs_pkey primary key (id),
  constraint log_correlation_runs_status_check check (status in ('running', 'succeeded', 'failed')),
  constraint log_correlation_runs_child_log_file_id_fkey
    foreign key (child_log_file_id_param) references public.log_files (id),
  constraint log_correlation_runs_parent_log_file_id_fkey
    foreign key (parent_log_file_id_param) references public.log_files (id),
  constraint log_correlation_runs_resolved_parent_log_file_id_fkey
    foreign key (resolved_parent_log_file_id) references public.log_files (id)
);

comment on table public.log_correlation_runs is
  'Audit log of every run_log_correlation() execution (scheduled sweep or manual reprocess). child_log_file_id_param is the camera1 file that was processed; parent_log_file_id_param is the override if one was passed; resolved_parent_log_file_id is whichever camera2 file actually got used (override or auto-resolved from job identity). allow_reprocess is always false for the scheduled cron sweep.';
