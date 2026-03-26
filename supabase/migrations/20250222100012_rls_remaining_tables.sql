-- Enable RLS on all app tables. Access only via service role (API routes use createAdminClient).
-- anon and authenticated get no rows (using false / with check false); service_role bypasses RLS.

alter table public.customer enable row level security;
alter table public.customer_sequence enable row level security;
alter table public.batch enable row level security;
alter table public.batch_downloads enable row level security;
alter table public.log_files enable row level security;
alter table public.log_entries enable row level security;

create policy "Service role only: customer"
  on public.customer for all
  using (false)
  with check (false);

create policy "Service role only: customer_sequence"
  on public.customer_sequence for all
  using (false)
  with check (false);

create policy "Service role only: batch"
  on public.batch for all
  using (false)
  with check (false);

create policy "Service role only: batch_downloads"
  on public.batch_downloads for all
  using (false)
  with check (false);

create policy "Service role only: log_files"
  on public.log_files for all
  using (false)
  with check (false);

create policy "Service role only: log_entries"
  on public.log_entries for all
  using (false)
  with check (false);
