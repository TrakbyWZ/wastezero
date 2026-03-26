create table if not exists public.report_customer_bags (
  id uuid not null default gen_random_uuid(),
  page_key text not null,
  customer_id uuid null,
  customer_num text null,
  customer_description text null,
  label_prefix text null,
  customer_sequence_id uuid null,
  cam1_log_file_id uuid not null,
  cam1_filename text null,
  cam1_upload_timestamp timestamp with time zone null,
  cam1_job_name text null,
  cam1_job_start_timestamp timestamp with time zone null,
  cam1_job_end_timestamp timestamp with time zone null,
  cam1_data_value text null,
  cam1_data_timestamp timestamp with time zone null,
  cam1_sort_order integer not null,
  data_value text null,
  data_timestamp timestamp with time zone null,
  constraint report_customer_bags_pkey primary key (id),
  constraint report_customer_bags_cam1_log_file_id_fkey
    foreign key (cam1_log_file_id)
    references public.log_files (id)
    on delete cascade,
  constraint report_customer_bags_customer_id_fkey
    foreign key (customer_id)
    references public.customer (id)
    on delete set null,
  constraint report_customer_bags_customer_sequence_id_fkey
    foreign key (customer_sequence_id)
    references public.customer_sequence (id)
    on delete set null
);

create index if not exists idx_report_customer_bags_page_key
  on public.report_customer_bags (page_key desc);

create index if not exists idx_report_customer_bags_customer_page_key
  on public.report_customer_bags (customer_id, page_key desc);

create index if not exists idx_report_customer_bags_cam1_file
  on public.report_customer_bags (cam1_log_file_id, cam1_sort_order);

comment on table public.report_customer_bags is
  'Precomputed Customer Bags report rows maintained incrementally during log ingest.';

comment on column public.report_customer_bags.page_key is
  'Lexicographically sortable cursor key derived from cam1_job_start_timestamp, cam1_log_file_id, and cam1_sort_order.';

alter table public.report_customer_bags enable row level security;

create policy "Service role only: report_customer_bags"
  on public.report_customer_bags for all
  using (false)
  with check (false);

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

comment on function public.refresh_customer_bags_report_for_log_file(uuid) is
  'Deletes and rebuilds Customer Bags rows for camera-1 files affected by a newly ingested log file.';

create or replace function public.finalize_log_file_ingest(p_log_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.flag_log_entries_duplicates_for_file(p_log_file_id);
  perform public.refresh_customer_bags_report_for_log_file(p_log_file_id);
end;
$$;

comment on function public.finalize_log_file_ingest(uuid) is
  'Finalizes ingest side effects for a log file in one transaction: duplicate flagging/counts and Customer Bags refresh.';

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
