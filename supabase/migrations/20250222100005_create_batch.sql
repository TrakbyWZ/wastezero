create table public.batch (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  customer_sequence_id uuid not null,
  start_sequence bigint null,
  end_sequence bigint null,
  offset_sequence integer null,
  label_count integer null,
  start_time timestamp with time zone null,
  end_time timestamp with time zone null,
  filename text null,
  created_by text null,
  created_date timestamp with time zone null default now(),
  modified_by text null,
  modified_date timestamp with time zone null default now(),
  constraint batch_pkey primary key (id),
  constraint batch_customer_id_fkey foreign key (customer_id) references public.customer (id) on delete restrict,
  constraint batch_customer_sequence_id_fkey foreign key (customer_sequence_id) references public.customer_sequence (id) on delete restrict
);

comment on column public.batch.filename is
  'Filename for the batch CSV download, e.g. ACME_20250222_143052.csv';

create index if not exists idx_batch_start_time on public.batch using btree (start_time desc);

create trigger trg_batch_modified
  before update on public.batch
  for each row
  execute function public.set_modified_date();
