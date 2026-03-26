alter table public.log_files
add column if not exists duplicate_count integer not null default 0;

with duplicate_counts as (
  select le.log_file_id, count(*)::integer as duplicate_count
  from public.log_entries le
  where le.is_duplicate = true
  group by le.log_file_id
)
update public.log_files lf
set duplicate_count = coalesce(dc.duplicate_count, 0)
from duplicate_counts dc
where lf.id = dc.log_file_id;

update public.log_files lf
set duplicate_count = 0
where not exists (
  select 1
  from public.log_entries le
  where le.log_file_id = lf.id
    and le.is_duplicate = true
);

comment on column public.log_files.duplicate_count is
  'Materialized count of duplicate log_entries rows for this file.';

create or replace function public.get_log_file_duplicate_counts()
returns table(log_file_id uuid, duplicate_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select lf.id as log_file_id, lf.duplicate_count::bigint
  from public.log_files lf
  where lf.duplicate_count > 0;
$$;

comment on function public.get_log_file_duplicate_counts() is
  'Returns materialized duplicate counts from public.log_files.';

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
  ),
  affected_log_file_ids as (
    select distinct le.log_file_id
    from public.log_entries le
    inner join affected_values av
      on av.data_value = le.data_value
    union
    select p_log_file_id
  ),
  updated_duplicates as (
    update public.log_entries e
    set is_duplicate = (vc.total_count > 1)
    from value_counts vc
    where e.data_value = vc.data_value
      and nullif(trim(e.data_value), '') is not null
      and e.data_value not in ('Bad Read', 'Bad_Read')
      and e.is_duplicate is distinct from (vc.total_count > 1)
    returning e.log_file_id
  ),
  duplicate_counts as (
    select le.log_file_id, count(*)::integer as duplicate_count
    from public.log_entries le
    where le.is_duplicate = true
      and le.log_file_id in (
        select log_file_id from affected_log_file_ids
      )
    group by le.log_file_id
  )
  update public.log_files lf
  set duplicate_count = coalesce(dc.duplicate_count, 0)
  from affected_log_file_ids afl
  left join duplicate_counts dc
    on dc.log_file_id = afl.log_file_id
  where lf.id = afl.log_file_id;
end;
$$;

comment on function public.flag_log_entries_duplicates_for_file(uuid) is
  'Incrementally updates is_duplicate and log_files.duplicate_count for data values present in the specified uploaded file.';

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
  lf.uploaded_by,
  lf.duplicate_count::bigint as duplicate_count
from public.log_files lf;

comment on view public.vw_api_log_files_list is
  'GET /api/log-files: log files with materialized duplicate count. Order by upload_timestamp desc in API.';
