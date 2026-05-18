-- Ingest path: insert-only into log_files and log_entries.
-- Duplicate data_value flagging and customer-bags refresh are not run on upload.

drop trigger if exists trg_log_entries_increment_eligible_counts on public.log_entries;
drop trigger if exists trg_log_entries_decrement_eligible_counts on public.log_entries;

create or replace function public.finalize_log_file_ingest(p_log_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  null;
end;
$$;

comment on function public.finalize_log_file_ingest(uuid) is
  'No-op retained for compatibility. Ingest only inserts log_files/log_entries; duplicate flagging and report refresh run separately.';
