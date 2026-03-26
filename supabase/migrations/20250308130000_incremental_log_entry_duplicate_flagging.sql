-- Incremental duplicate flagging for newly uploaded log files.
-- Recomputes duplicate status only for data_value values introduced by the uploaded file,
-- instead of rescanning the entire log_entries table on every ingest.

create or replace function public.flag_log_entries_duplicates_for_file(p_log_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with affected_values as (
    select distinct le.data_value
    from public.log_entries le
    where le.log_file_id = p_log_file_id
      and nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
  ),
  value_counts as (
    select le.data_value, count(*)::bigint as total_count
    from public.log_entries le
    inner join affected_values av
      on av.data_value = le.data_value
    where nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
    group by le.data_value
  )
  update public.log_entries e
  set is_duplicate = (vc.total_count > 1)
  from value_counts vc
  where e.data_value = vc.data_value
    and nullif(trim(e.data_value), '') is not null
    and e.data_value not in ('Bad Read', 'Bad_Read')
    and e.is_duplicate is distinct from (vc.total_count > 1);
end;
$$;

comment on function public.flag_log_entries_duplicates_for_file(uuid) is
  'Incrementally updates is_duplicate only for data_value values present in the specified uploaded file.';
