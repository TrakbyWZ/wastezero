-- Full refresh of report_customer_bags from log_entries (e.g. when table was not populated during ingest).
-- Call via: select public.refresh_customer_bags_report_full();
-- Or from the app: POST /api/reports/customer-bags/refresh (authenticated).

create or replace function public.refresh_customer_bags_report_full()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.report_customer_bags;

  insert into public.report_customer_bags (
    page_key,
    customer_id,
    customer_num,
    customer_description,
    label_prefix,
    customer_sequence_id,
    cam1_log_file_id,
    cam1_filename,
    cam1_upload_timestamp,
    cam1_job_name,
    cam1_job_start_timestamp,
    cam1_job_end_timestamp,
    cam1_data_value,
    cam1_data_timestamp,
    cam1_sort_order,
    data_value,
    data_timestamp
  )
  with header_file as (
    select
      lf.filename,
      lf.upload_timestamp,
      le.log_file_id,
      le.job_start_timestamp,
      le.data_timestamp,
      le.data_value,
      lag(le.data_timestamp) over (
        partition by le.log_file_id
        order by le.data_timestamp
      ) as last_data_timestamp
    from public.log_entries le
    inner join public.log_files lf
      on lf.id = le.log_file_id
    where le.log_file_header = 'Camera 2 Log File'
      and nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
  )
  select
    coalesce(
      to_char(c1.job_start_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      '0001-01-01T00:00:00.000Z'
    ) || '|' || c1.log_file_id::text || '|' || lpad(c1.sort_order::text, 10, '0') as page_key,
    cs.customer_id,
    c.customer_num,
    c.customer_description,
    cs.label_prefix,
    cs.id as customer_sequence_id,
    f.id as cam1_log_file_id,
    f.filename as cam1_filename,
    f.upload_timestamp as cam1_upload_timestamp,
    c1.job_name as cam1_job_name,
    c1.job_start_timestamp as cam1_job_start_timestamp,
    c1.job_end_timestamp as cam1_job_end_timestamp,
    c1.data_value as cam1_data_value,
    c1.data_timestamp as cam1_data_timestamp,
    c1.sort_order as cam1_sort_order,
    hf.data_value,
    hf.data_timestamp
  from public.log_entries c1
  inner join public.log_files f
    on f.id = c1.log_file_id
  inner join public.customer_sequence cs
    on c1.data_value like cs.label_prefix || '%'
    and c1.data_value ~ ('^' || cs.label_prefix || '\d{' || length(cs.number_format)::text || '}$')
  inner join public.customer c
    on c.id = cs.customer_id
  left join header_file hf
    on c1.data_timestamp >= coalesce(hf.last_data_timestamp, hf.job_start_timestamp)
    and c1.data_timestamp < hf.data_timestamp
  where c1.log_file_header = 'Camera 1 Log File'
    and nullif(trim(c1.data_value), '') is not null
    and c1.data_value not in ('Bad Read', 'Bad_Read')
  order by c1.job_start_timestamp desc nulls last, c1.log_file_id desc, c1.sort_order desc;
end;
$$;

comment on function public.refresh_customer_bags_report_full() is
  'Truncates and repopulates report_customer_bags from log_entries. Use when the table was not populated during ingest or to force a full rebuild.';
