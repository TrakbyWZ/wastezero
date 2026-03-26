-- Log files that have been uploaded and parsed (renamed from synced_files).
create table public.log_files (
  id uuid not null default gen_random_uuid(),
  filename text not null,
  upload_timestamp timestamp with time zone not null default now(),
  total_reads integer not null default 0,
  bad_reads integer not null default 0,
  sequence_reads integer not null default 0,
  uploaded_by text null,
  raw_content text null,
  created_at timestamp with time zone not null default now(),
  constraint log_files_pkey primary key (id)
);

create index if not exists idx_log_files_upload_timestamp on public.log_files using btree (upload_timestamp desc);
create unique index if not exists idx_unique_log_files_filename on public.log_files using btree (filename);

comment on column public.log_files.raw_content is 'Original file content for download; optional for large files.';
comment on column public.log_files.bad_reads is 'Count of log_entries with data_value = Bad_Read.';
comment on column public.log_files.sequence_reads is 'Count from log file footer "Sequence Reads: N" (summed across blocks when present).';
comment on column public.log_files.uploaded_by is 'Email of the user who uploaded the file (from app session).';
