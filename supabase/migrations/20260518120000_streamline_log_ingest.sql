-- Ingest path: insert-only into log_files and log_entries.
-- Duplicate data_value flagging and customer-bags refresh are not run on upload.

drop trigger if exists trg_log_entries_increment_eligible_counts on public.log_entries;
drop trigger if exists trg_log_entries_decrement_eligible_counts on public.log_entries;

drop function if exists public.finalize_log_file_ingest(uuid);
