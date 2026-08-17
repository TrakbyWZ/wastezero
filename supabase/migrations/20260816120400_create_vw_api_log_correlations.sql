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
  lc.created_timestamp,
  lc.modified_timestamp
from public.log_correlations lc
inner join public.log_entries child_entry on child_entry.id = lc.child_log_entry_id
inner join public.log_files child_file on child_file.id = child_entry.log_file_id
left join public.log_entries parent_entry on parent_entry.id = lc.parent_log_entry_id
left join public.log_files parent_file on parent_file.id = parent_entry.log_file_id
left join public.customer cust on cust.id = lc.customer_id
order by lc.job_date desc, lc.job_name, lc.child_code;

comment on view public.vw_api_log_correlations is
  'Read model for GET /api/log-correlations: log_correlations joined out to operator/filename (log_entries/log_files) and customer_num/customer_description (customer) for QC display. Filter/sort columns (child_code, parent_code, timestamps, job keys) already live directly on log_correlations.';
