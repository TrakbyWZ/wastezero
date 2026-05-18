-- Ingest no longer calls finalize_log_file_ingest; remove unused no-op function.

drop function if exists public.finalize_log_file_ingest(uuid);
