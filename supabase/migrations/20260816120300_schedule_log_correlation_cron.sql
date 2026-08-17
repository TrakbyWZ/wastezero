-- Enables pg_cron (verified available/preloaded on this project's Postgres)
-- and schedules the unscoped, insert-only sweep every 10 minutes.
create extension if not exists pg_cron;

select cron.schedule(
  'run-log-correlation',
  '*/10 * * * *',
  $$select public.run_log_correlation()$$
);
