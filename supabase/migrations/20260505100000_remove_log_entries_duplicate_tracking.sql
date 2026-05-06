-- Remove log_entries.is_duplicate, log_files.duplicate_count, eligible-value count table,
-- and all duplicate-flagging routines. log_entries holds raw structured rows only.

create or replace function public.finalize_log_file_ingest(p_log_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_customer_bags_report_for_log_file(p_log_file_id);
end;
$$;

comment on function public.finalize_log_file_ingest(uuid) is
  'Finalizes ingest side effects for a log file: Customer Bags refresh.';

drop function if exists public.flag_log_entries_duplicates_for_file(uuid);

drop trigger if exists trg_log_entries_increment_eligible_counts on public.log_entries;
drop trigger if exists trg_log_entries_decrement_eligible_counts on public.log_entries;

drop function if exists public.increment_eligible_value_counts_from_inserted_log_entries();
drop function if exists public.decrement_eligible_value_counts_from_deleted_log_entries();

drop policy if exists "Service role only: log_entry_eligible_value_counts"
  on public.log_entry_eligible_value_counts;

drop table if exists public.log_entry_eligible_value_counts;

drop function if exists public.get_log_file_duplicate_counts();
drop function if exists public.flag_log_entries_duplicates();

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

alter table public.log_entries drop column if exists is_duplicate;

alter table public.log_files drop column if exists duplicate_count;
