-- Re-creates run_log_correlation() (originally from
-- 20260816120200_create_run_log_correlation.sql) identically except the
-- insert into log_correlations now also populates the new
-- child_log_file_id column, which fill_log_correlation_gaps() (next
-- migration) relies on to scope its work per child file.
create or replace function public.run_log_correlation(
  p_child_log_file_id uuid,
  p_parent_log_file_id uuid default null,
  p_triggered_by text default 'cron',
  p_allow_reprocess boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_job_name text;
  v_job_number text;
  v_job_date date;
  v_parent_candidates uuid[];
  v_parent_match_count integer;
  v_resolved_parent_log_file_id uuid;
  v_rows_inserted integer := 0;
  v_rows_updated integer := 0;
  v_rows_unresolved integer := 0;
  v_updated_unresolved integer := 0;
begin
  if p_child_log_file_id is null then
    raise exception 'p_child_log_file_id is required';
  end if;

  insert into public.log_correlation_runs (
    triggered_by, allow_reprocess, child_log_file_id_param, parent_log_file_id_param
  ) values (
    p_triggered_by, p_allow_reprocess, p_child_log_file_id, p_parent_log_file_id
  )
  returning id into v_run_id;

  begin
    select job_name, job_number, (job_start_timestamp at time zone 'UTC')::date
    into v_job_name, v_job_number, v_job_date
    from public.log_entries
    where log_file_id = p_child_log_file_id
      and log_file_header = 'Camera 1 Log File'
    limit 1;

    if not found then
      raise exception 'log_file_id % has no Camera 1 Log File entries', p_child_log_file_id;
    end if;

    if p_parent_log_file_id is not null then
      v_resolved_parent_log_file_id := p_parent_log_file_id;
    else
      select array_agg(distinct log_file_id)
      into v_parent_candidates
      from public.log_entries
      where log_file_header = 'Camera 2 Log File'
        and coalesce(job_name, chr(1)) = coalesce(v_job_name, chr(1))
        and coalesce(job_number, chr(1)) = coalesce(v_job_number, chr(1))
        and coalesce((job_start_timestamp at time zone 'UTC')::date, '0001-01-01'::date)
          = coalesce(v_job_date, '0001-01-01'::date);

      v_parent_match_count := coalesce(array_length(v_parent_candidates, 1), 0);

      if v_parent_match_count > 1 then
        raise exception
          'Ambiguous parent file for child %: % Camera 2 Log File candidates match job (%, %, %)',
          p_child_log_file_id, v_parent_match_count, v_job_name, v_job_number, v_job_date;
      end if;

      v_resolved_parent_log_file_id := v_parent_candidates[1];
    end if;

    if v_resolved_parent_log_file_id is not null
      and not exists (
        select 1 from public.log_entries
        where log_file_id = v_resolved_parent_log_file_id
          and log_file_header = 'Camera 2 Log File'
      )
    then
      raise exception 'log_file_id % has no Camera 2 Log File entries', v_resolved_parent_log_file_id;
    end if;

    update public.log_correlation_runs
    set resolved_parent_log_file_id = v_resolved_parent_log_file_id
    where id = v_run_id;

    if v_resolved_parent_log_file_id is null then
      -- Not ready: no matching camera2 file yet, and no override given.
      update public.log_correlation_runs
      set run_completed_at = now(), status = 'succeeded'
      where id = v_run_id;
      return v_run_id;
    end if;

    with inserted as (
      insert into public.log_correlations (
        child_log_entry_id, parent_log_entry_id, child_code, parent_code,
        child_code_timestamp, parent_code_timestamp, job_name, job_number, job_date,
        customer_id, customer_sequence_id, child_log_file_id, created_by, modified_by
      )
      select
        m.child_log_entry_id, m.parent_log_entry_id, m.child_code, m.parent_code,
        m.child_code_timestamp, m.parent_code_timestamp, m.job_name, m.job_number, m.job_date,
        m.customer_id, m.customer_sequence_id, p_child_log_file_id, v_run_id, v_run_id
      from public.log_correlation_candidates(p_child_log_file_id, v_resolved_parent_log_file_id, p_allow_reprocess) m
      where not exists (
        select 1 from public.log_correlations lc where lc.child_log_entry_id = m.child_log_entry_id
      )
      returning parent_log_entry_id
    )
    select count(*), count(*) filter (where parent_log_entry_id is null)
    into v_rows_inserted, v_rows_unresolved
    from inserted;

    if p_allow_reprocess then
      with updated as (
        update public.log_correlations lc
        set
          parent_log_entry_id = m.parent_log_entry_id,
          parent_code = m.parent_code,
          parent_code_timestamp = m.parent_code_timestamp,
          customer_id = m.customer_id,
          customer_sequence_id = m.customer_sequence_id,
          modified_timestamp = now(),
          modified_by = v_run_id
        from public.log_correlation_candidates(p_child_log_file_id, v_resolved_parent_log_file_id, true) m
        where lc.child_log_entry_id = m.child_log_entry_id
          and (
            m.parent_log_entry_id is distinct from lc.parent_log_entry_id
            or m.customer_id is distinct from lc.customer_id
            or m.customer_sequence_id is distinct from lc.customer_sequence_id
          )
        returning lc.parent_log_entry_id
      )
      select count(*), count(*) filter (where parent_log_entry_id is null)
      into v_rows_updated, v_updated_unresolved
      from updated;

      v_rows_unresolved := v_rows_unresolved + v_updated_unresolved;
    end if;

    update public.log_correlation_runs
    set
      run_completed_at = now(),
      status = 'succeeded',
      rows_inserted = v_rows_inserted,
      rows_updated = v_rows_updated,
      rows_unresolved = v_rows_unresolved
    where id = v_run_id;
  exception when others then
    -- Deliberately does not re-raise: a bare RAISE here would abort the
    -- enclosing transaction, rolling back this very UPDATE (and the initial
    -- INSERT) along with it, defeating the point of a durable audit trail.
    -- Callers must check the returned run's `status` rather than relying on
    -- an RPC-level error to detect failure.
    update public.log_correlation_runs
    set run_completed_at = now(), status = 'failed', error_message = sqlerrm
    where id = v_run_id;
  end;

  return v_run_id;
end;
$$;

comment on function public.run_log_correlation(uuid, uuid, text, boolean) is
  'Correlates one camera1 log file (p_child_log_file_id) against its camera2 parent file, auto-resolved from job identity unless p_parent_log_file_id overrides it. Zero resolvable parent -> succeeds with 0 rows (not ready). More than one candidate parent -> recorded as a failed run (see below). p_allow_reprocess must be explicitly true to revise an already-correlated row; the default (used by the scheduled sweep) only ever inserts new rows. This function never raises for expected/handled failures (e.g. ambiguous parent) — it always returns a run id, and always records the outcome on log_correlation_runs; callers must check that row''s `status`/`error_message` rather than relying on an RPC-level error. It does not re-raise on unexpected errors either, for the same reason: re-raising would abort the enclosing transaction and roll back the very audit row meant to record the failure. Populates child_log_file_id on every inserted row so fill_log_correlation_gaps() can scope its work per child file.';
