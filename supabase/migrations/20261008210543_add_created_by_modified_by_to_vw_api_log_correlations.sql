-- Append created_by/modified_by (both FKs to log_correlation_runs) to
-- vw_api_log_correlations so a run's export endpoint can select rows it
-- created or last touched without querying the raw table directly.
-- CREATE OR REPLACE VIEW can only append columns, never reorder/insert
-- mid-list - these go at the end.
create or replace view vw_api_log_correlations as
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
  lc.child_log_file_id,
  lc.created_by,
  lc.modified_by
from log_correlations lc
left join log_entries child_entry on child_entry.id = lc.child_log_entry_id
left join log_files child_file on child_file.id = child_entry.log_file_id
left join log_entries parent_entry on parent_entry.id = lc.parent_log_entry_id
left join log_files parent_file on parent_file.id = parent_entry.log_file_id
left join customer cust on cust.id = lc.customer_id
order by lc.job_date desc, lc.job_name, (coalesce(lc.usr_child_code, lc.child_code));
