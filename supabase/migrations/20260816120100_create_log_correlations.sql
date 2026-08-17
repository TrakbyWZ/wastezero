-- One row per camera1 log_entries row: its ceiling-matched camera2 parent
-- code and owning customer_sequence. See
-- docs/superpowers/specs/2026-08-16-log-file-data-correlation-design.md.
create table public.log_correlations (
  id uuid not null default gen_random_uuid(),
  child_log_entry_id uuid not null,
  parent_log_entry_id uuid null,
  child_code text not null,
  parent_code text null,
  child_code_timestamp timestamp with time zone not null,
  parent_code_timestamp timestamp with time zone null,
  job_name text null,
  job_number text null,
  job_date date not null,
  customer_id uuid null,
  customer_sequence_id uuid null,
  created_timestamp timestamp with time zone not null default now(),
  created_by uuid not null,
  modified_timestamp timestamp with time zone not null default now(),
  modified_by uuid not null,
  usr_child_code text null,
  usr_parent_code text null,
  usr_exclude_row boolean not null default false,
  notes text null,
  overridden_by text null,
  overridden_at timestamp with time zone null,
  constraint log_correlations_pkey primary key (id),
  constraint log_correlations_child_log_entry_id_key unique (child_log_entry_id),
  constraint log_correlations_child_log_entry_id_fkey
    foreign key (child_log_entry_id) references public.log_entries (id) on delete cascade,
  constraint log_correlations_parent_log_entry_id_fkey
    foreign key (parent_log_entry_id) references public.log_entries (id) on delete cascade,
  constraint log_correlations_customer_id_fkey
    foreign key (customer_id) references public.customer (id) on delete set null,
  constraint log_correlations_customer_sequence_id_fkey
    foreign key (customer_sequence_id) references public.customer_sequence (id) on delete set null,
  constraint log_correlations_created_by_fkey
    foreign key (created_by) references public.log_correlation_runs (id),
  constraint log_correlations_modified_by_fkey
    foreign key (modified_by) references public.log_correlation_runs (id)
);

create index log_correlations_job_key_idx on public.log_correlations (job_name, job_number, job_date);
create index log_correlations_child_code_idx on public.log_correlations (child_code);
create index log_correlations_parent_code_idx on public.log_correlations (parent_code);
create index log_correlations_customer_id_idx on public.log_correlations (customer_id);

comment on table public.log_correlations is
  'One row per camera1 log_entries row, ceiling-matched to its nearest camera2 parent code and resolved to its owning customer_sequence. Written by run_log_correlation(); child_log_entry_id is unique and is the upsert key. usr_child_code/usr_parent_code/usr_exclude_row/notes are user-entered data-quality corrections, never touched by run_log_correlation() - overridden_by/overridden_at track who made a correction and when, separate from created_by/modified_by (which track the automated run, not a human).';
