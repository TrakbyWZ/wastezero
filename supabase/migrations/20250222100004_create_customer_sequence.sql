create table public.customer_sequence (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  label_prefix text null,
  number_format text null,
  attributes jsonb null,
  start_seq bigint null default 1,
  end_seq bigint null,
  offset_sequence integer null default 1,
  created_by text null,
  created_date timestamp with time zone null default now(),
  modified_by text null,
  modified_date timestamp with time zone null default now(),
  is_default boolean null default false,
  constraint customer_sequence_pkey primary key (id),
  constraint customer_sequence_customer_id_fkey foreign key (customer_id) references public.customer (id) on delete cascade
);

create trigger trg_customer_sequence_modified
  before update on public.customer_sequence
  for each row
  execute function public.set_modified_date();

create unique index customer_sequence_one_default_per_customer
  on public.customer_sequence (customer_id)
  where is_default = true;

comment on index customer_sequence_one_default_per_customer is
  'Ensures at most one row per customer has is_default = true.';

-- Prevent duplicate customer sequences: same customer + label prefix + number format.
-- NULLS NOT DISTINCT so (customer_id, null, null) can only appear once per customer.

create unique index customer_sequence_customer_label_format_key
  on public.customer_sequence (customer_id, label_prefix, number_format)
  nulls not distinct;

comment on index customer_sequence_customer_label_format_key is
  'At most one sequence per customer with the same label prefix and number format.';