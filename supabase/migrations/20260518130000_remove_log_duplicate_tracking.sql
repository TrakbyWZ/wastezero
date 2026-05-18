-- Remove data-value duplicate tracking from log tables and related DB objects.

-- vw_customer_sequence_xref used le.* / lef.*, which pinned a dependency on is_duplicate.
create or replace view public.vw_customer_sequence_xref
with (security_invoker = on)
as
with header_file as (
  select
    le.log_file_id,
    lef.filename,
    lef.upload_timestamp,
    le.log_file_header,
    le.job_name,
    le.operator,
    le.job_start_timestamp,
    le.job_end_timestamp,
    le.data_timestamp,
    le.data_value,
    le.sort_order,
    lag(le.data_timestamp) over (partition by le.log_file_id order by le.data_timestamp) as last_data_timestamp
  from public.log_entries le
  left join public.log_files lef
    on lef.id = le.log_file_id
  where le.log_file_header = 'Camera 2 Log File'
    and le.data_value not in ('Bad_Read')
    and nullif(trim(le.data_value), '') is not null
)
select
  f.id as cam1_log_file_id,
  f.filename as cam1_filename,
  f.upload_timestamp as cam1_upload_timestamp,
  c1.log_file_header as cam1_log_file_header,
  c1.job_name as cam1_job_name,
  c1.operator as cam1_operator,
  c1.job_start_timestamp as cam1_job_start_timestamp,
  c1.job_end_timestamp as cam1_job_end_timestamp,
  c1.data_timestamp as cam1_data_timestamp,
  c1.data_value as cam1_data_value,
  c1.sort_order as cam1_sort_order,
  hf.log_file_id,
  hf.filename,
  hf.upload_timestamp,
  hf.log_file_header,
  hf.job_name,
  hf.operator,
  hf.job_start_timestamp,
  hf.job_end_timestamp,
  hf.data_timestamp,
  hf.last_data_timestamp,
  hf.data_value,
  hf.sort_order,
  cs.customer_id,
  cs.label_prefix,
  cs.id as customer_sequence_id,
  c.customer_num,
  c.customer_description
from public.log_entries c1
inner join public.log_files f
  on f.id = c1.log_file_id
inner join public.customer_sequence cs
  on c1.data_value ~ public.customer_sequence_cam1_data_value_regex(cs.label_prefix, cs.number_format)
inner join public.customer c
  on c.id = cs.customer_id
left join header_file hf
  on c1.data_timestamp >= coalesce(hf.last_data_timestamp, hf.job_start_timestamp)
  and c1.data_timestamp < hf.data_timestamp
where c1.data_value not in ('Bad_Read')
  and nullif(trim(c1.data_value), '') is not null
  and c1.log_file_header = 'Camera 1 Log File'
order by c1.data_timestamp;

-- CREATE OR REPLACE cannot remove columns from an existing view.
drop view if exists public.vw_api_log_files_list;

create view public.vw_api_log_files_list
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

drop table if exists public.log_entry_eligible_value_counts;

drop function if exists public.get_log_file_duplicate_counts();
drop function if exists public.flag_log_entries_duplicates_for_file(uuid);
drop function if exists public.flag_log_entries_duplicates();
drop function if exists public.increment_eligible_value_counts_from_inserted_log_entries();
drop function if exists public.decrement_eligible_value_counts_from_deleted_log_entries();
