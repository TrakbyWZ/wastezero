-- Remove data-value duplicate tracking from log tables and related DB objects.

alter table public.log_entries drop column if exists is_duplicate;

alter table public.log_files drop column if exists duplicate_count;

drop table if exists public.log_entry_eligible_value_counts;

drop function if exists public.get_log_file_duplicate_counts();
drop function if exists public.flag_log_entries_duplicates_for_file(uuid);
drop function if exists public.flag_log_entries_duplicates();
drop function if exists public.increment_eligible_value_counts_from_inserted_log_entries();
drop function if exists public.decrement_eligible_value_counts_from_deleted_log_entries();

create or replace view public.vw_api_log_files_list
with (security_invoker = on)
as
select
  lf.id,
  lf.filename,
  lf.upload_timestamp,
  lf.total_reads,
  lf.bad_reads,
  lf.sequence_reads,
  lf.uploaded_by
from public.log_files lf;

comment on view public.vw_api_log_files_list is
  'GET /api/log-files: log files list. Order by upload_timestamp desc in API.';
