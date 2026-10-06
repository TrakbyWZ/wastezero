-- Adds "which files were correlated" visibility, requested in review:
-- the Quality Control list screen and the detail screen's run-history
-- panel both showed the child file but never which camera2 (parent) file
-- it was actually correlated against.

-- Re-creates vw_api_log_correlation_files (originally from
-- 20261006120000_create_vw_api_log_correlation_files.sql) to also expose
-- the most recent correlate run's resolved parent file, appended at the
-- end (CREATE OR REPLACE VIEW can only append columns, not insert them
-- mid-list).
create or replace view public.vw_api_log_correlation_files
with (security_invoker = on)
as
with file_counts as (
  select
    lc.child_log_file_id,
    min(lc.job_name) as job_name,
    min(lc.job_number) as job_number,
    min(lc.job_date) as job_date,
    min(lc.customer_id::text)::uuid as customer_id,
    count(*) as total_count,
    count(*) filter (
      where lc.is_inferred = false
        and lc.usr_child_code is null
        and lc.overridden_by is null
        and (lc.child_code is null or lc.child_code = 'Bad_Read' or btrim(lc.child_code) = '')
    ) as unresolved_count,
    count(*) filter (where lc.usr_exclude_row) as excluded_count,
    count(*) filter (where lc.is_inferred) as inferred_count,
    max(lc.created_timestamp) as last_row_created_at
  from public.log_correlations lc
  group by lc.child_log_file_id
)
select
  fc.child_log_file_id,
  cf.filename as child_filename,
  fc.job_name,
  fc.job_number,
  fc.job_date,
  fc.customer_id,
  cust.customer_num,
  cust.customer_description,
  fc.total_count,
  fc.unresolved_count,
  fc.excluded_count,
  fc.inferred_count,
  fc.last_row_created_at,
  correlate_run.run_started_at as last_correlate_run_at,
  correlate_run.status as last_correlate_run_status,
  gap_fill_run.run_started_at as last_gap_fill_run_at,
  gap_fill_run.status as last_gap_fill_run_status,
  correlate_run.resolved_parent_log_file_id as last_correlate_resolved_parent_file_id,
  parent_file.filename as last_correlate_parent_filename
from file_counts fc
join public.log_files cf on cf.id = fc.child_log_file_id
left join public.customer cust on cust.id = fc.customer_id
left join lateral (
  select r.run_started_at, r.status, r.resolved_parent_log_file_id
  from public.log_correlation_runs r
  where r.child_log_file_id_param = fc.child_log_file_id
    and r.operation = 'correlate'
  order by r.run_started_at desc
  limit 1
) correlate_run on true
left join lateral (
  select r.run_started_at, r.status
  from public.log_correlation_runs r
  where r.child_log_file_id_param = fc.child_log_file_id
    and r.operation = 'gap_fill'
  order by r.run_started_at desc
  limit 1
) gap_fill_run on true
left join public.log_files parent_file on parent_file.id = correlate_run.resolved_parent_log_file_id;

comment on view public.vw_api_log_correlation_files is
  'Read model for GET /api/log-correlation-files: one row per child_log_file_id with job/customer identity, row-status counts (unresolved_count mirrors log_correlations_pending_gap_fill_idx''s predicate exactly), the most recent run of each operation kind (correlate, gap_fill), and the parent (camera2) file the most recent correlate run resolved - null if that run never found/was given one. Backs the Quality Control list screen.';

-- New: one row per log_correlation_runs row, with filenames resolved for
-- every file-id column it carries. Backs the Quality Control detail
-- screen's run-history panel ("which files were correlated" for that
-- run) - replaces reading log_correlation_runs directly in
-- GET /api/log-correlation-runs.
create or replace view public.vw_api_log_correlation_runs
with (security_invoker = on)
as
select
  r.*,
  child_file.filename as child_filename,
  param_file.filename as parent_log_file_id_param_filename,
  resolved_file.filename as resolved_parent_filename
from public.log_correlation_runs r
join public.log_files child_file on child_file.id = r.child_log_file_id_param
left join public.log_files param_file on param_file.id = r.parent_log_file_id_param
left join public.log_files resolved_file on resolved_file.id = r.resolved_parent_log_file_id
order by r.run_started_at desc;

comment on view public.vw_api_log_correlation_runs is
  'Read model for GET /api/log-correlation-runs: log_correlation_runs with every file-id column it carries resolved to a filename. child_filename is the camera1 file processed; parent_log_file_id_param_filename is non-null only when an explicit parent override was passed (a manual call); resolved_parent_filename is whichever camera2 file actually got used (override or auto-resolved), null if the run never found one (not-ready correlate run, or a gap_fill run before any row in the file has ever resolved a parent). Backs the Quality Control detail screen''s run-history panel.';
