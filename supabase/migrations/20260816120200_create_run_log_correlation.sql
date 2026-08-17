-- Internal helper for run_log_correlation(): computes, for every eligible
-- camera1 (child) log_entries row in scope, its ceiling-matched camera2
-- (parent) row and its owning customer_sequence. Not meant to be called
-- directly outside run_log_correlation() — execute is not granted to
-- anon/authenticated/service_role.
create or replace function public.log_correlation_candidates(
  p_job_name text,
  p_job_number text,
  p_job_date date,
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
  with ready_jobs as (
    select
      job_name,
      job_number,
      date_trunc('day', job_start_timestamp)::date as job_date
    from public.log_entries
    where log_file_header in ('Camera 1 Log File', 'Camera 2 Log File')
      and job_name is not null
      and job_number is not null
      and job_start_timestamp is not null
      and (p_job_name is null or job_name = p_job_name)
      and (p_job_number is null or job_number = p_job_number)
      and (p_job_date is null or date_trunc('day', job_start_timestamp)::date = p_job_date)
    group by job_name, job_number, date_trunc('day', job_start_timestamp)::date
    having count(*) filter (where log_file_header = 'Camera 1 Log File') > 0
       and count(*) filter (where log_file_header = 'Camera 2 Log File') > 0
  ),
  candidates as (
    select le.*
    from public.log_entries le
    inner join ready_jobs rj
      on le.job_name = rj.job_name
      and le.job_number = rj.job_number
      and date_trunc('day', le.job_start_timestamp)::date = rj.job_date
    where le.log_file_header = 'Camera 1 Log File'
      and le.data_value <> 'Bad_Read'
      and nullif(trim(le.data_value), '') is not null
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
    date_trunc('day', c.job_start_timestamp)::date,
    parent.id,
    parent.data_value,
    parent.data_timestamp,
    cs.customer_id,
    cs.id
  from candidates c
  left join lateral (
    select p.id, p.data_value, p.data_timestamp
    from public.log_entries p
    where p.log_file_header = 'Camera 2 Log File'
      and p.job_name = c.job_name
      and p.job_number = c.job_number
      and date_trunc('day', p.job_start_timestamp)::date = date_trunc('day', c.job_start_timestamp)::date
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

revoke execute on function public.log_correlation_candidates(text, text, date, boolean) from public, anon, authenticated, service_role;

comment on function public.log_correlation_candidates(text, text, date, boolean) is
  'Internal helper for run_log_correlation(): computes ceiling-matched parent and customer_sequence linkage per camera1 log_entries row. Not for direct/RPC use.';

-- Core processing function: pairs camera1/camera2 files for a job,
-- ceiling-matches each child code to its nearest parent code, resolves
-- customer_sequence linkage, and inserts/updates log_correlations.
create or replace function public.run_log_correlation(
  p_job_name text default null,
  p_job_number text default null,
  p_job_date date default null,
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
  v_rows_inserted integer := 0;
  v_rows_updated integer := 0;
  v_rows_unresolved integer := 0;
  v_updated_unresolved integer := 0;
begin
  insert into public.log_correlation_runs (
    triggered_by, allow_reprocess, job_name_param, job_number_param, job_date_param
  ) values (
    p_triggered_by, p_allow_reprocess, p_job_name, p_job_number, p_job_date
  )
  returning id into v_run_id;

  begin
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
      from public.log_correlation_candidates(p_job_name, p_job_number, p_job_date, p_allow_reprocess) m
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
        from public.log_correlation_candidates(p_job_name, p_job_number, p_job_date, true) m
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
    update public.log_correlation_runs
    set run_completed_at = now(), status = 'failed', error_message = sqlerrm
    where id = v_run_id;
    raise;
  end;

  return v_run_id;
end;
$$;

revoke execute on function public.run_log_correlation(text, text, date, text, boolean) from public, anon, authenticated;
grant execute on function public.run_log_correlation(text, text, date, text, boolean) to service_role;

comment on function public.run_log_correlation(text, text, date, text, boolean) is
  'Pairs camera1/camera2 log_entries by job, ceiling-matches child codes to parent codes, resolves customer_sequence linkage, and upserts log_correlations. p_allow_reprocess must be explicitly true to revise an already-correlated row; the default (used by the scheduled cron job) only ever inserts new rows. Every call is logged to log_correlation_runs.';
