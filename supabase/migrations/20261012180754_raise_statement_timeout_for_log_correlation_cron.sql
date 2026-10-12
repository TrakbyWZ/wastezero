-- The default statement_timeout (2min) is too short for the very first sweep
-- run against a database with an existing backlog of unprocessed files - the
-- initial production deploy's every-10-minute ticks all failed with
-- "canceling statement due to statement timeout", rolling back the whole
-- run (including the log_correlation_runs row that would record the
-- failure) since the cancellation isn't caught by the functions' own
-- exception handling.
--
-- Scope the raise to just this job's own command (not the postgres role or
-- database as a whole) so every other query still gets the normal 2min
-- guard - this is an upsert by job name (see
-- 20260816120300_schedule_log_correlation_cron.sql), so re-registering it
-- here just changes the command going forward, no unschedule needed.
select cron.schedule(
  'run-log-correlation',
  '*/10 * * * *',
  $$set statement_timeout = '10min'; select public.run_log_correlation_sweep()$$
);
