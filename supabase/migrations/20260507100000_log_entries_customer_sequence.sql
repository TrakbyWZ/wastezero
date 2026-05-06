-- Optional resolved sequence attribution per log row (populated by downstream logic).

alter table public.log_entries
  add column if not exists customer_sequence_id uuid null,
  add column if not exists sequence_number bigint null;

comment on column public.log_entries.customer_sequence_id is
  'Customer sequence this row was matched to, when resolved.';
comment on column public.log_entries.sequence_number is
  'Numeric sequence portion extracted or derived for this row (int8).';

alter table public.log_entries drop constraint if exists log_entries_customer_sequence_id_fkey;

alter table public.log_entries
  add constraint log_entries_customer_sequence_id_fkey
  foreign key (customer_sequence_id)
  references public.customer_sequence (id)
  on delete set null;

create index if not exists idx_log_entries_customer_sequence_id
  on public.log_entries using btree (customer_sequence_id);
