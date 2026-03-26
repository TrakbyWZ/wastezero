create table public.customer (
  id uuid not null default gen_random_uuid(),
  customer_num text not null,
  customer_description text null,
  contact_email text null,
  is_active boolean not null default true,
  created_by text null,
  created_date timestamp with time zone null default now(),
  modified_by text null,
  modified_date timestamp with time zone null default now(),
  constraint customer_pkey primary key (id),
  constraint customer_customer_num_key unique (customer_num),
  constraint customer_customer_num_alphanumeric check (customer_num ~ '^[A-Za-z0-9_]+$') not valid
);

comment on column public.customer.contact_email is 'Contact email for the customer';
comment on column public.customer.is_active is 'Whether the customer is active (shown as Active/Inactive in UI)';

create trigger trg_customer_modified
  before update on public.customer
  for each row
  execute function public.set_modified_date();

comment on constraint customer_customer_num_alphanumeric on public.customer is
  'Customer number must contain only letters, digits, and underscores (no spaces or other special characters).';