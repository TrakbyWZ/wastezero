-- Restrict users and login_otp to service role only (API routes use service role).
-- anon and authenticated cannot read or modify these tables.
alter table public.users enable row level security;
alter table public.login_otp enable row level security;

create policy "Service role only: users"
  on public.users for all
  using (false)
  with check (false);

create policy "Service role only: login_otp"
  on public.login_otp for all
  using (false)
  with check (false);

-- Service role bypasses RLS, so no policy is needed for it.
