-- Backs "what was the most recent gap_fill run for this child file" below:
-- without it, that lookup is an unindexed scan of log_correlation_runs per
-- candidate file every sweep tick.
create index log_correlation_runs_gap_fill_lookup_idx
  on public.log_correlation_runs (child_log_file_id_param, run_started_at desc)
  where operation = 'gap_fill';

-- Re-creates run_log_correlation_sweep() (originally from
-- 20260816120200_create_run_log_correlation.sql, gap-fill pass added in
-- 20261005120200_create_fill_log_correlation_gaps.sql) to stop re-attempting
-- fill_log_correlation_gaps() every 10 minutes forever on a file whose
-- remaining placeholder row(s) are permanently unfillable (ambiguous, wider
-- than p_max_gap_span, or leading/trailing - see fill_log_correlation_gaps()'s
-- own comment for exactly which shapes those are). Without this, such a file
-- matches log_correlations_pending_gap_fill_idx forever (nothing about it
-- ever changes), so every sweep tick re-ran the full gap-fill walk and wrote
-- a new, almost entirely no-op log_correlation_runs row for it - correct,
-- but unbounded audit-log noise for a file nothing further can be done for
-- automatically.
--
-- A file's second loop candidacy now also requires one of:
--   - no gap_fill run has ever been attempted for it yet, or
--   - its most recent gap_fill run actually made progress (inserted or
--     updated at least one row) - worth confirming once more, though for
--     this data model a run that makes any progress already resolves
--     everything resolvable in that same call, so a same-data rerun is
--     never able to make further progress itself; this is a one-tick
--     grace rather than a progress-chasing loop, and
--   - something has changed in the file's log_correlations rows since that
--     run completed (modified_timestamp > its run_completed_at) - e.g. a
--     manual p_allow_refill := true call, or (once a review/edit UI exists)
--     a human correcting/excluding a row by hand.
-- This never gates fill_log_correlation_gaps() itself, nor a direct manual
-- call to it (see content/docs/log-correlation-operations.md) - a db admin
-- can always explicitly retrigger gap-fill for any file regardless of this
-- sweep-only throttle. It only stops the automatic sweep from repeatedly
-- re-discovering a result that cannot change on its own.
create or replace function public.run_log_correlation_sweep(
  p_triggered_by text default 'cron'
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_log_file_id uuid;
  v_run_id uuid;
begin
  for v_child_log_file_id in
    select distinct le.log_file_id
    from public.log_entries le
    where le.log_file_header = 'Camera 1 Log File'
      and not exists (
        select 1 from public.log_correlations lc where lc.child_log_entry_id = le.id
      )
      and exists (
        select 1
        from public.log_entries p
        where p.log_file_header = 'Camera 2 Log File'
          and coalesce(p.job_name, chr(1)) = coalesce(le.job_name, chr(1))
          and coalesce(p.job_number, chr(1)) = coalesce(le.job_number, chr(1))
          and coalesce((p.job_start_timestamp at time zone 'UTC')::date, '0001-01-01'::date)
            = coalesce((le.job_start_timestamp at time zone 'UTC')::date, '0001-01-01'::date)
      )
  loop
    begin
      v_run_id := public.run_log_correlation(
        p_child_log_file_id := v_child_log_file_id,
        p_triggered_by := p_triggered_by
      );
      return next v_run_id;
    exception when others then
      null;
    end;
  end loop;

  for v_child_log_file_id in
    select f.child_log_file_id
    from (
      select distinct lc.child_log_file_id
      from public.log_correlations lc
      where lc.is_inferred = false
        and lc.usr_child_code is null
        and lc.overridden_by is null
        and (lc.child_code is null or lc.child_code = 'Bad_Read' or btrim(lc.child_code) = '')
    ) f
    left join lateral (
      select r.run_completed_at, r.rows_inserted, r.rows_updated
      from public.log_correlation_runs r
      where r.child_log_file_id_param = f.child_log_file_id
        and r.operation = 'gap_fill'
      order by r.run_started_at desc
      limit 1
    ) last_run on true
    where last_run.run_completed_at is null
       or coalesce(last_run.rows_inserted, 0) > 0
       or coalesce(last_run.rows_updated, 0) > 0
       or exists (
         select 1
         from public.log_correlations lc2
         where lc2.child_log_file_id = f.child_log_file_id
           and lc2.modified_timestamp > last_run.run_completed_at
       )
  loop
    begin
      v_run_id := public.fill_log_correlation_gaps(
        p_child_log_file_id := v_child_log_file_id,
        p_triggered_by := p_triggered_by
      );
      return next v_run_id;
    exception when others then
      null;
    end;
  end loop;

  return;
end;
$$;

comment on function public.run_log_correlation_sweep(text) is
  'Cron entry point: finds every camera1 log file with a resolvable parent file and pending unprocessed rows, and calls run_log_correlation() once per file; then finds every already-correlated child file with at least one untouched Bad_Read/blank placeholder row left - skipping a file whose most recent gap_fill run already made zero progress and nothing has changed since (permanently stuck - ambiguous, too wide, or leading/trailing - see fill_log_correlation_gaps()''s comment) - and calls fill_log_correlation_gaps() once per remaining file. This throttle only applies to the automatic sweep; fill_log_correlation_gaps() can still be called manually for any file at any time. Per-file failures are caught (and already logged via log_correlation_runs) so one bad file does not block the rest of the sweep.';
