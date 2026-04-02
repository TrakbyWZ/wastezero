-- Label prefix templates (UTC calendar, month/year/day only): %MMYYDD%, %YYYYMMDD%, %MMYY%,
-- %DDMM%, %YYYY%, %MM%, %DD%, %YY%. Camera-1 scanned values (e.g. 042602-R002C0000001) match
-- via regex built from the stored template (e.g. %MMYYDD%-R002C).

create or replace function public.customer_sequence_cam1_data_value_regex(
  p_label_prefix text,
  p_number_format text
)
returns text
language plpgsql
immutable
as $$
declare
  body text;
  n integer;
begin
  body := coalesce(p_label_prefix, '');
  body := replace(body, '%MMYYDD%', chr(1));
  body := replace(body, '%YYYYMMDD%', chr(2));
  body := replace(body, '%MMYY%', chr(7));
  body := replace(body, '%DDMM%', chr(8));
  body := replace(body, '%YYYY%', chr(3));
  body := replace(body, '%MM%', chr(4));
  body := replace(body, '%DD%', chr(5));
  body := replace(body, '%YY%', chr(6));
  body := regexp_replace(body, '([.+*?^$()[\]{}|\\])', E'\\\1', 'g');
  body := replace(body, chr(1), E'\\d{6}');
  body := replace(body, chr(2), E'\\d{8}');
  body := replace(body, chr(7), E'\\d{4}');
  body := replace(body, chr(8), E'\\d{4}');
  body := replace(body, chr(3), E'\\d{4}');
  body := replace(body, chr(4), E'\\d{2}');
  body := replace(body, chr(5), E'\\d{2}');
  body := replace(body, chr(6), E'\\d{2}');

  n := length(coalesce(nullif(trim(p_number_format), ''), ''));
  if n <= 0 then
    return '^' || body || '$';
  end if;
  return '^' || body || '\d{' || n::text || '}$';
end;
$$;

comment on function public.customer_sequence_cam1_data_value_regex(text, text) is
  'Camera-1 label match regex: expands M/Y/D tokens (%MMYYDD%, %YYYYMMDD%, %MMYY%, %DDMM%, %YYYY%, %MM%, %DD%, %YY%) to digit classes; escapes literals; appends fixed-width sequence digits.';

create or replace view public.vw_customer_sequence_xref
with (security_invoker = on)
as
with header_file as (
  select lef.*,
    le.*,
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

create or replace function public.refresh_customer_bags_report_for_log_file(p_log_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with incoming_camera_2_intervals as (
    select
      le.log_file_id,
      le.job_start_timestamp,
      le.data_timestamp,
      lag(le.data_timestamp) over (
        partition by le.log_file_id
        order by le.data_timestamp
      ) as last_data_timestamp
    from public.log_entries le
    where le.log_file_id = p_log_file_id
      and le.log_file_header = 'Camera 2 Log File'
      and nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
  ),
  affected_cam1_files as (
    select distinct c1.log_file_id
    from public.log_entries c1
    where c1.log_file_id = p_log_file_id
      and c1.log_file_header = 'Camera 1 Log File'
      and nullif(trim(c1.data_value), '') is not null
      and c1.data_value not in ('Bad Read', 'Bad_Read')
    union
    select distinct c1.log_file_id
    from public.log_entries c1
    inner join incoming_camera_2_intervals i2
      on c1.data_timestamp >= coalesce(i2.last_data_timestamp, i2.job_start_timestamp)
      and c1.data_timestamp < i2.data_timestamp
    where c1.log_file_header = 'Camera 1 Log File'
      and nullif(trim(c1.data_value), '') is not null
      and c1.data_value not in ('Bad Read', 'Bad_Read')
  )
  delete from public.report_customer_bags rcb
  where rcb.cam1_log_file_id in (
    select acf.log_file_id
    from affected_cam1_files acf
  );

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
  with incoming_camera_2_intervals as (
    select
      le.log_file_id,
      le.job_start_timestamp,
      le.data_timestamp,
      lag(le.data_timestamp) over (
        partition by le.log_file_id
        order by le.data_timestamp
      ) as last_data_timestamp
    from public.log_entries le
    where le.log_file_id = p_log_file_id
      and le.log_file_header = 'Camera 2 Log File'
      and nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
  ),
  affected_cam1_files as (
    select distinct c1.log_file_id
    from public.log_entries c1
    where c1.log_file_id = p_log_file_id
      and c1.log_file_header = 'Camera 1 Log File'
      and nullif(trim(c1.data_value), '') is not null
      and c1.data_value not in ('Bad Read', 'Bad_Read')
    union
    select distinct c1.log_file_id
    from public.log_entries c1
    inner join incoming_camera_2_intervals i2
      on c1.data_timestamp >= coalesce(i2.last_data_timestamp, i2.job_start_timestamp)
      and c1.data_timestamp < i2.data_timestamp
    where c1.log_file_header = 'Camera 1 Log File'
      and nullif(trim(c1.data_value), '') is not null
      and c1.data_value not in ('Bad Read', 'Bad_Read')
  ),
  header_file as (
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
  inner join affected_cam1_files acf
    on acf.log_file_id = c1.log_file_id
  inner join public.customer_sequence cs
    on c1.data_value ~ public.customer_sequence_cam1_data_value_regex(cs.label_prefix, cs.number_format)
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
    on c1.data_value ~ public.customer_sequence_cam1_data_value_regex(cs.label_prefix, cs.number_format)
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
