-- Optional per-row processing lifecycle for downstream pipelines (defaults null at ingest).

alter table public.log_entries
  add column if not exists processing_started_at timestamp with time zone null,
  add column if not exists processing_completed_at timestamp with time zone null,
  add column if not exists processing_failed_at timestamp with time zone null,
  add column if not exists processing_error_msg text null;

comment on column public.log_entries.processing_started_at is
  'When asynchronous processing of this row began; null if not started.';
comment on column public.log_entries.processing_completed_at is
  'When processing finished successfully; null if incomplete or failed.';
comment on column public.log_entries.processing_failed_at is
  'When processing failed; null if still pending, in progress, or successful.';
comment on column public.log_entries.processing_error_msg is
  'Error detail when processing_failed_at is set; plain text or serialized JSON for troubleshooting.';
