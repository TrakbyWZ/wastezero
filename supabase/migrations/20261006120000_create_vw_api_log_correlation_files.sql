-- Backs the Quality Control list screen's per-file summary and the detail
-- screen's "every row for this file" queries. Both existing indexes
-- touching child_log_file_id are partial (log_correlations_pending_gap_fill_idx,
-- log_correlations_inferred_child_file_code_idx), so neither serves an
-- unfiltered GROUP BY/WHERE on this column.
create index log_correlations_child_log_file_id_idx
  on public.log_correlations (child_log_file_id);

-- Backs the view's two "most recent run of this operation for this file"
-- lateral lookups below (one per operation). A narrower partial index
-- already exists for 'gap_fill' alone (log_correlation_runs_gap_fill_lookup_idx,
-- used by the sweep's own throttle check) - this one additionally covers
-- 'correlate' lookups, which have no index today.
create index log_correlation_runs_child_file_operation_idx
  on public.log_correlation_runs (child_log_file_id_param, operation, run_started_at desc);

-- One row per child log file that has at least one log_correlations row:
-- job/customer identity, row counts by status, and when it was last
-- touched/run. Used by GET /api/log-correlation-files to back the Quality
-- Control list screen. Aggregates log_correlations down to one row per
-- file first (file_counts), then joins run history onto that already-
-- deduplicated set - so each lateral "most recent run" lookup runs once
-- per file, not once per log_correlations row.
create or replace view public.vw_api_log_correlation_files
with (security_invoker = on)
as
with file_counts as (
  select
    lc.child_log_file_id,
    -- job_name/job_number/job_date/customer_id are wrapped in min() rather
    -- than grouped on directly: they're already constant per
    -- child_log_file_id in practice (the same assumption
    -- run_log_correlation() itself makes when it reads a child file's job
    -- identity via its own `limit 1`), but nothing in the schema enforces
    -- that across every row of one file. min() keeps this CTE at exactly
    -- one row per child_log_file_id regardless - an arbitrary-but-
    -- deterministic pick is the right failure mode if that assumption
    -- ever breaks, not a silently duplicated file row.
    min(lc.job_name) as job_name,
    min(lc.job_number) as job_number,
    min(lc.job_date) as job_date,
    -- uuid has no built-in min()/max() aggregate (unlike text/date) despite
    -- supporting comparison operators - round-trip through text.
    min(lc.customer_id::text)::uuid as customer_id,
    count(*) as total_count,
    -- Deliberately identical to log_correlations_pending_gap_fill_idx's
    -- predicate: "unresolved" here means exactly "the automatic gap-fill
    -- sweep still considers this worth attempting or has given up on it".
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
  gap_fill_run.status as last_gap_fill_run_status
from file_counts fc
join public.log_files cf on cf.id = fc.child_log_file_id
left join public.customer cust on cust.id = fc.customer_id
left join lateral (
  select r.run_started_at, r.status
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
) gap_fill_run on true;

comment on view public.vw_api_log_correlation_files is
  'Read model for GET /api/log-correlation-files: one row per child_log_file_id with job/customer identity, row-status counts (unresolved_count mirrors log_correlations_pending_gap_fill_idx''s predicate exactly), and the most recent run of each operation kind (correlate, gap_fill). Backs the Quality Control list screen.';

-- Re-creates vw_api_log_correlations (originally from
-- 20260816120400_create_vw_api_log_correlations.sql, last changed in
-- 20261005120300_update_vw_api_log_correlations_for_gap_fill.sql) to also
-- expose child_log_file_id, appended at the end (CREATE OR REPLACE VIEW
-- cannot reorder or insert columns mid-list, only append) - the Quality
-- Control detail screen needs it to filter GET /api/log-correlations down
-- to one file.
create or replace view public.vw_api_log_correlations
with (security_invoker = on)
as
select
  lc.id,
  lc.child_log_entry_id,
  lc.parent_log_entry_id,
  lc.child_code,
  lc.parent_code,
  lc.child_code_timestamp,
  lc.parent_code_timestamp,
  lc.job_name,
  lc.job_number,
  lc.job_date,
  lc.customer_id,
  lc.customer_sequence_id,
  child_entry.operator as child_operator,
  child_file.filename as child_filename,
  parent_entry.operator as parent_operator,
  parent_file.filename as parent_filename,
  cust.customer_num,
  cust.customer_description,
  lc.usr_child_code,
  lc.usr_parent_code,
  lc.usr_exclude_row,
  lc.notes,
  lc.overridden_by,
  lc.overridden_at,
  lc.created_timestamp,
  lc.modified_timestamp,
  child_entry.sort_order as child_sort_order,
  parent_entry.sort_order as parent_sort_order,
  lc.is_inferred,
  coalesce(lc.usr_child_code, lc.child_code) as effective_child_code,
  coalesce(lc.usr_parent_code, lc.parent_code) as effective_parent_code,
  lc.child_log_file_id
from public.log_correlations lc
left join public.log_entries child_entry on child_entry.id = lc.child_log_entry_id
left join public.log_files child_file on child_file.id = child_entry.log_file_id
left join public.log_entries parent_entry on parent_entry.id = lc.parent_log_entry_id
left join public.log_files parent_file on parent_file.id = parent_entry.log_file_id
left join public.customer cust on cust.id = lc.customer_id
order by lc.job_date desc, lc.job_name, coalesce(lc.usr_child_code, lc.child_code);

comment on view public.vw_api_log_correlations is
  'Read model for GET /api/log-correlations: log_correlations joined out to operator/filename (log_entries/log_files) and customer_num/customer_description (customer) for QC display. Filter/sort columns (child_code, parent_code, timestamps, job keys) already live directly on log_correlations. child_entry/child_file/parent_entry/parent_file are left joins (not inner) because is_inferred rows have no backing log_entries row at all. usr_child_code/usr_parent_code/usr_exclude_row/notes/overridden_by/overridden_at are passed through as-is; effective_child_code/effective_parent_code add coalesce(usr_*, *) so callers get "the code we actually believe" without repeating that logic. child_log_file_id lets callers (the Quality Control detail screen) filter to one file directly, without going through child_log_entry_id (which is_inferred rows do not have). This view does not filter out excluded rows (that is a report-level decision for callers to make).';
