-- Individual data rows from a parsed log file.
create table public.log_entries (
  id uuid not null default gen_random_uuid(),
  log_file_id uuid not null,
  log_file_header text null,
  job_name text null,
  job_number text null,
  operator text null,
  job_start_timestamp timestamp with time zone null,
  job_end_timestamp timestamp with time zone null,
  data_value text not null,
  data_timestamp timestamp with time zone not null,
  is_duplicate boolean not null default false,
  sort_order integer not null default 0,
  constraint log_entries_pkey primary key (id),
  constraint log_entries_log_file_id_fkey foreign key (log_file_id) references public.log_files (id) on delete cascade
);

create index if not exists idx_log_entries_log_file_id on public.log_entries using btree (log_file_id);
create index if not exists idx_log_entries_sort on public.log_entries using btree (log_file_id, sort_order);
create index if not exists idx_log_entries_data_value on public.log_entries using btree (data_value);


comment on column public.log_entries.log_file_header is 'Header line from the log file (e.g. Camera 1 Log File, Camera 2 Log File).';
comment on column public.log_entries.job_name is 'Job name from the log block.';
comment on column public.log_entries.job_number is 'Job number from the log block.';
comment on column public.log_entries.operator is 'Operator from the log block.';
comment on column public.log_entries.job_start_timestamp is 'Job start timestamp from the log block.';
comment on column public.log_entries.job_end_timestamp is 'Job end timestamp from the log block.';
comment on column public.log_entries.data_value is 'Value from the _Data column (e.g. Camera_1_Data, Camera_2_Data).';
comment on column public.log_entries.data_timestamp is 'Timestamp from the Date_Time_Stamp column.';
comment on column public.log_entries.sort_order is 'Order of the row within the log file.';
comment on column public.log_entries.is_duplicate is 'True when this data_value appears more than once in this file or in another log file.';