-- Enable RLS on the log-correlation tables (GitHub issue #37, Supabase advisor
-- rls_disabled_in_public). These were created in 20260816120000/120100 without
-- RLS, leaving them readable/writable by anon and authenticated via PostgREST.
--
-- Same model as 20250222100012_rls_remaining_tables.sql: access only via the
-- service role (API routes use createAdminClient). The correlation functions
-- (run_log_correlation, fill_log_correlation_gaps, sweeps) are SECURITY DEFINER
-- and run as the table owner, and service_role bypasses RLS, so neither is
-- affected. The vw_api_log_correlation* views are security_invoker, so they
-- inherit this protection for anon/authenticated as well.

alter table public.log_correlation_runs enable row level security;
alter table public.log_correlations enable row level security;

create policy "Service role only: log_correlation_runs"
  on public.log_correlation_runs for all
  using (false)
  with check (false);

create policy "Service role only: log_correlations"
  on public.log_correlations for all
  using (false)
  with check (false);
