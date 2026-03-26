-- Audit table for batch CSV generation/download. One row per generation or download event.
create table public.batch_downloads (
  id uuid not null default gen_random_uuid(),
  batch_id uuid not null,
  user_id uuid null,
  created_at timestamp with time zone not null default now(),
  constraint batch_downloads_pkey primary key (id),
  constraint batch_downloads_batch_id_fkey foreign key (batch_id) references public.batch (id) on delete cascade,
  constraint batch_downloads_user_id_fkey foreign key (user_id) references public.users (id) on delete set null
);

create index if not exists idx_batch_downloads_batch_id on public.batch_downloads using btree (batch_id);
create index if not exists idx_batch_downloads_created_at on public.batch_downloads using btree (created_at desc);
