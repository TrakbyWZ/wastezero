-- Fixes "Inferred flag not being appropriately set when gap fills occur"
-- (issue #34: PINK__C.csv shows no inferred rows despite 11 gap-filled codes).
--
-- is_inferred is a *structural* flag: true only for a synthetic row with no
-- backing log_entries row (gap type B). fill_log_correlation_gaps() also
-- infers codes for gap type A - a Bad_Read/blank row that physically exists
-- gets usr_child_code set to the inferred number and overridden_by =
-- 'gap-fill' - and those rows keep is_inferred = false. A file whose gaps
-- are all type A (PINK__C.csv: 11 type-A fills, 0 type-B rows) therefore
-- reads as "nothing inferred" on the QC screen, in the status=inferred
-- filter, and in inferred_count, even though 11 of its codes are machine-
-- inferred rather than camera-read.
--
-- is_inferred itself cannot simply be set true for gap type A: the
-- fill_log_correlation_gaps() walk selects `where is_inferred = false` to
-- find the known reads that bound a gap (a filled type-A row must stay
-- visible there to bound the *next* gap), log_correlations_inferred_or_real_check
-- relies on is_inferred implying child_code is null, and the partial unique
-- index log_correlations_inferred_child_file_code_idx
-- (child_log_file_id, usr_child_code) where is_inferred would start
-- colliding with real rows. So the structural flag keeps its meaning and the
-- read models gain a derived one answering the question QC and Power BI
-- actually ask: "was this code inferred by the machine, or actually read?"
--
-- A human correction is deliberately NOT inferred: once a reviewer sets
-- usr_child_code themselves, overridden_by becomes their id/email and a
-- type-A row goes back to is_child_code_inferred = false (a verified value,
-- not a guess). A type-B row stays true via is_inferred regardless - the row
-- is still synthetic, whoever last edited its code.

-- Re-creates vw_api_log_correlations (last from
-- 20261008210543_add_created_by_modified_by_to_vw_api_log_correlations.sql)
-- to append is_child_code_inferred. CREATE OR REPLACE VIEW can only append
-- columns, never reorder/insert mid-list - it goes at the end.
--
-- The `with (security_invoker = on)` is restored here: it was present when
-- this view was created (20261005120300) but silently dropped by
-- 20261008210543, which re-created the view without the clause - CREATE OR
-- REPLACE VIEW resets reloptions that aren't restated. Without it the view
-- runs as its owner and so reads log_correlations past RLS for anon/
-- authenticated, both of which hold SELECT on it. Every app read goes
-- through the service role (which bypasses RLS either way), so restoring it
-- changes no app behavior - it only closes that bypass.
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
  lc.child_log_file_id,
  lc.created_by,
  lc.modified_by,
  (lc.is_inferred or lc.overridden_by is not distinct from 'gap-fill') as is_child_code_inferred
from public.log_correlations lc
left join public.log_entries child_entry on child_entry.id = lc.child_log_entry_id
left join public.log_files child_file on child_file.id = child_entry.log_file_id
left join public.log_entries parent_entry on parent_entry.id = lc.parent_log_entry_id
left join public.log_files parent_file on parent_file.id = parent_entry.log_file_id
left join public.customer cust on cust.id = lc.customer_id
order by lc.job_date desc, lc.job_name, coalesce(lc.usr_child_code, lc.child_code);

comment on column public.vw_api_log_correlations.is_child_code_inferred is
  'True when effective_child_code was produced by fill_log_correlation_gaps() rather than read by the camera or entered by a reviewer: either a synthetic gap type B row (is_inferred) or a gap type A in-place correction (overridden_by = ''gap-fill''). This - not is_inferred - is what "is this code inferred?" means for QC display, the status=inferred filter, and Power BI; is_inferred remains the narrower structural question "does this row have a backing log_entries row at all?". Goes false again if a human later overwrites a type A fill, since overridden_by then names them instead.';

-- Re-creates vw_api_log_correlation_files (last from
-- 20261006120100_add_parent_file_info.sql) to append inferred_code_count,
-- the file-level counterpart of is_child_code_inferred. inferred_count is
-- left exactly as it was (synthetic rows only) so nothing already reading it
-- changes meaning underneath.
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
    count(*) filter (where lc.is_inferred or lc.overridden_by is not distinct from 'gap-fill') as inferred_code_count,
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
  parent_file.filename as last_correlate_parent_filename,
  fc.inferred_code_count
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

comment on column public.vw_api_log_correlation_files.inferred_code_count is
  'How many of this file''s rows have an inferred effective_child_code (vw_api_log_correlations.is_child_code_inferred): synthetic gap type B rows plus gap type A rows gap-fill corrected in place. Always >= inferred_count, which counts synthetic rows only. A file whose gaps were all type A has inferred_count = 0 and inferred_code_count > 0 - the case issue #34 reported.';
