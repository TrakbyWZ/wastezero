-- Re-creates vw_api_log_correlations (originally from
-- 20260816120400_create_vw_api_log_correlations.sql) to surface
-- fill_log_correlation_gaps() output:
--   - child_entry/child_file switch from inner to left join, because an
--     is_inferred row (gap type B) has no backing log_entries row at all -
--     an inner join would make it invisible to GET /api/log-correlations
--     and Power BI entirely.
--   - is_inferred is exposed so callers can distinguish a synthetic row
--     from a real one.
--   - effective_child_code/effective_parent_code expose
--     coalesce(usr_*, *) so callers don't need to repeat that coalesce
--     themselves to get "the code we actually believe", whether that came
--     from the algorithm or a correction/fill.
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
  coalesce(lc.usr_parent_code, lc.parent_code) as effective_parent_code
from public.log_correlations lc
left join public.log_entries child_entry on child_entry.id = lc.child_log_entry_id
left join public.log_files child_file on child_file.id = child_entry.log_file_id
left join public.log_entries parent_entry on parent_entry.id = lc.parent_log_entry_id
left join public.log_files parent_file on parent_file.id = parent_entry.log_file_id
left join public.customer cust on cust.id = lc.customer_id
order by lc.job_date desc, lc.job_name, coalesce(lc.usr_child_code, lc.child_code);

comment on view public.vw_api_log_correlations is
  'Read model for GET /api/log-correlations: log_correlations joined out to operator/filename (log_entries/log_files) and customer_num/customer_description (customer) for QC display. Filter/sort columns (child_code, parent_code, timestamps, job keys) already live directly on log_correlations. child_entry/child_file/parent_entry/parent_file are left joins (not inner) because is_inferred rows have no backing log_entries row at all. usr_child_code/usr_parent_code/usr_exclude_row/notes/overridden_by/overridden_at are passed through as-is; effective_child_code/effective_parent_code add coalesce(usr_*, *) so callers get "the code we actually believe" without repeating that logic. This view does not filter out excluded rows (that is a report-level decision for callers to make).';
