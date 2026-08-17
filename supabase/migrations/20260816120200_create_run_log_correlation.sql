-- Speeds up the ceiling-match lateral join in log_correlation_candidates()
-- below: without this, matching each camera1 code against its camera2
-- candidates is an unindexed scan of every candidate parent row per child
-- row (O(child_rows * parent_rows)) - measured at a ~131M cost plan / several
-- minutes on real production files (~20k child x ~10k parent rows after
-- Bad_Read filtering). The expression must match the query's
-- substring(data_value from '(\d+)$')::bigint exactly, or Postgres won't use
-- this index for the ORDER BY ... LIMIT 1 ceiling lookup.
create index log_entries_camera2_numeric_value_idx
  on public.log_entries (log_file_id, (substring(data_value from '(\d+)$')::bigint))
  where log_file_header = 'Camera 2 Log File' and data_value <> 'Bad_Read';

-- Speeds up job-identity matching (auto-resolving a child file's parent
-- file, and the sweep's own readiness check) in run_log_correlation() and
-- run_log_correlation_sweep(): without this, every "is there a camera2 file
-- for this job" check is an unindexed scan of every camera2 row, once per
-- candidate camera1 row.
--
-- Two deliberate expression choices, both required for the planner to
-- actually use this index for a per-row parameterized nested-loop scan
-- (not just to build a filtered set once and then compare row-by-row):
--   1. `(job_start_timestamp at time zone 'UTC')::date` instead of
--      `date_trunc('day', job_start_timestamp)::date` - the latter is only
--      STABLE (depends on the session timezone GUC), and Postgres requires
--      IMMUTABLE expressions in an index.
--   2. `coalesce(col, chr(1))` instead of comparing with `IS NOT DISTINCT
--      FROM` - job_name/job_number are frequently null in production data,
--      so a null-safe comparison is required, but Postgres cannot push
--      `IS NOT DISTINCT FROM` down as a per-row index condition in a
--      correlated nested loop (observed: it materializes every camera2 row
--      matching just the partial-index predicate, then compares each pair
--      via a generic join filter - no better than not having the index).
--      Coalescing both sides to a shared sentinel turns the comparison
--      back into plain `=`, which Postgres can push down normally.
-- Every query below must use this exact same coalesce(..., chr(1)) /
-- UTC-pinned-date form for the planner to use this index; log_correlations
-- rows now carry this same UTC-anchored job_date.
create index log_entries_camera2_job_key_idx
  on public.log_entries (
    (coalesce(job_name, chr(1))),
    (coalesce(job_number, chr(1))),
    (coalesce((job_start_timestamp at time zone 'UTC')::date, '0001-01-01'::date))
  )
  where log_file_header = 'Camera 2 Log File';

-- Internal helper for run_log_correlation(): computes, for every eligible
-- camera1 (child) row in one specific log file, its ceiling-matched camera2
-- (parent) row from one specific parent log file, and its owning
-- customer_sequence. Not meant to be called directly outside
-- run_log_correlation() — execute is not granted to
-- anon/authenticated/service_role.
create or replace function public.log_correlation_candidates(
  p_child_log_file_id uuid,
  p_parent_log_file_id uuid,
  p_allow_reprocess boolean
)
returns table (
  child_log_entry_id uuid,
  child_code text,
  child_code_timestamp timestamptz,
  job_name text,
  job_number text,
  job_date date,
  parent_log_entry_id uuid,
  parent_code text,
  parent_code_timestamp timestamptz,
  customer_id uuid,
  customer_sequence_id uuid
)
language sql
stable
as $$
  with candidates as (
    -- Deliberately does NOT exclude Bad_Read/empty child data_value here (unlike
    -- the parent-side lateral below, where Bad_Read/empty rows can never be a
    -- valid ceiling-match target): every camera1 row in this file should get a
    -- log_correlations row, so a bad camera1 read is visible as "attempted,
    -- unresolved" rather than silently missing from the table. A Bad_Read/empty
    -- child_code naturally never matches the parent lateral's prefix/numeric
    -- conditions or the customer_sequence regex, so it resolves to fully
    -- unresolved (parent + customer both null) without any special-casing.
    select le.*
    from public.log_entries le
    where le.log_file_id = p_child_log_file_id
      and le.log_file_header = 'Camera 1 Log File'
      and (
        p_allow_reprocess
        or not exists (
          select 1 from public.log_correlations lc where lc.child_log_entry_id = le.id
        )
      )
  )
  select
    c.id,
    c.data_value,
    c.data_timestamp,
    c.job_name,
    c.job_number,
    (c.job_start_timestamp at time zone 'UTC')::date,
    parent.id,
    parent.data_value,
    parent.data_timestamp,
    cs.customer_id,
    cs.id
  from candidates c
  left join lateral (
    select p.id, p.data_value, p.data_timestamp
    from public.log_entries p
    where p.log_file_id = p_parent_log_file_id
      and p.log_file_header = 'Camera 2 Log File'
      and p.data_value <> 'Bad_Read'
      and nullif(trim(p.data_value), '') is not null
      and regexp_replace(p.data_value, '\d+$', '') = regexp_replace(c.data_value, '\d+$', '')
      and substring(p.data_value from '(\d+)$')::bigint >= substring(c.data_value from '(\d+)$')::bigint
    order by substring(p.data_value from '(\d+)$')::bigint asc
    limit 1
  ) parent on true
  left join lateral (
    select cs2.id, cs2.customer_id
    from public.customer_sequence cs2
    where c.data_value ~ public.customer_sequence_cam1_data_value_regex(cs2.label_prefix, cs2.number_format)
    order by cs2.is_default desc, cs2.id asc
    limit 1
  ) cs on true;
$$;

revoke execute on function public.log_correlation_candidates(uuid, uuid, boolean) from public, anon, authenticated, service_role;

comment on function public.log_correlation_candidates(uuid, uuid, boolean) is
  'Internal helper for run_log_correlation(): computes ceiling-matched parent and customer_sequence linkage for camera1 entries in one specific log file, against one specific parent log file. Not for direct/RPC use.';

-- Core processing function: correlates one camera1 log file against its
-- camera2 parent file. The parent file is either passed explicitly
-- (p_parent_log_file_id, an override) or auto-resolved by matching the
-- child file's job_name/job_number/job_date against Camera 2 Log File
-- entries. Zero matches means the job isn't ready yet (succeeds with 0
-- rows); more than one match is a data anomaly and raises.
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
        customer_id, customer_sequence_id, created_by, modified_by
      )
      select
        m.child_log_entry_id, m.parent_log_entry_id, m.child_code, m.parent_code,
        m.child_code_timestamp, m.parent_code_timestamp, m.job_name, m.job_number, m.job_date,
        m.customer_id, m.customer_sequence_id, v_run_id, v_run_id
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

revoke execute on function public.run_log_correlation(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.run_log_correlation(uuid, uuid, text, boolean) to service_role;

comment on function public.run_log_correlation(uuid, uuid, text, boolean) is
  'Correlates one camera1 log file (p_child_log_file_id) against its camera2 parent file, auto-resolved from job identity unless p_parent_log_file_id overrides it. Zero resolvable parent -> succeeds with 0 rows (not ready). More than one candidate parent -> recorded as a failed run (see below). p_allow_reprocess must be explicitly true to revise an already-correlated row; the default (used by the scheduled sweep) only ever inserts new rows. This function never raises for expected/handled failures (e.g. ambiguous parent) — it always returns a run id, and always records the outcome on log_correlation_runs; callers must check that row''s `status`/`error_message` rather than relying on an RPC-level error. It does not re-raise on unexpected errors either, for the same reason: re-raising would abort the enclosing transaction and roll back the very audit row meant to record the failure.';

-- Cron entry point: finds every camera1 log file with a resolvable parent
-- file and pending unprocessed rows, and calls run_log_correlation() once
-- per file. run_log_correlation() itself never raises (see its comment),
-- so failures naturally can't stop this loop; the per-file exception guard
-- below is defense-in-depth only.
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
  return;
end;
$$;

revoke execute on function public.run_log_correlation_sweep(text) from public, anon, authenticated;
grant execute on function public.run_log_correlation_sweep(text) to service_role;

comment on function public.run_log_correlation_sweep(text) is
  'Cron entry point: finds every camera1 log file with a resolvable parent file and pending unprocessed rows, and calls run_log_correlation() once per file. Per-file failures are caught (and already logged via log_correlation_runs) so one bad file does not block the rest of the sweep.';
