-- Adds support for gap-filling log_correlations: inferred rows (camera1
-- numbers with no log_entries row at all) and user-corrected placeholder
-- rows (Bad_Read/blank camera1 reads), both written by
-- fill_log_correlation_gaps() (see next migration). See
-- content/docs/log-correlation-overview.md for the gap-fill algorithm.

-- child_log_file_id lets fill_log_correlation_gaps() scope its work to one
-- camera1 file without re-deriving it from child_log_entry_id (which is
-- null for inferred rows, so it couldn't be derived that way for those
-- rows anyway), and backs the dedupe unique index below. Backfilled from
-- the existing child_log_entry_id -> log_entries.log_file_id linkage;
-- run_log_correlation() is updated below to populate it for all new rows.
alter table public.log_correlations
  add column child_log_file_id uuid null;

update public.log_correlations lc
set child_log_file_id = le.log_file_id
from public.log_entries le
where le.id = lc.child_log_entry_id
  and lc.child_log_file_id is null;

alter table public.log_correlations
  add constraint log_correlations_child_log_file_id_fkey
    foreign key (child_log_file_id) references public.log_files (id) on delete cascade;

-- is_inferred marks a row with no backing camera1 log_entries row at all
-- (gap type B: a missing number in the sequence, not merely a Bad_Read).
-- Such a row has no child_log_entry_id/child_code/child_code_timestamp -
-- the check constraint below is the only place that invariant is relaxed.
alter table public.log_correlations
  add column is_inferred boolean not null default false;

alter table public.log_correlations
  alter column child_log_entry_id drop not null,
  alter column child_code drop not null,
  alter column child_code_timestamp drop not null;

alter table public.log_correlations
  add constraint log_correlations_inferred_or_real_check
  check (
    is_inferred
    or (
      child_log_entry_id is not null
      and child_code is not null
      and child_code_timestamp is not null
    )
  );

-- Prevents fill_log_correlation_gaps() from inserting duplicate inferred
-- rows for the same missing number on a re-run (e.g. the next sweep tick
-- before correlation itself has changed). Real rows are unaffected (they
-- already have a unique child_log_entry_id and is_inferred = false, so
-- they never collide with this partial index).
create unique index log_correlations_inferred_child_file_code_idx
  on public.log_correlations (child_log_file_id, usr_child_code)
  where is_inferred;

-- Distinguishes log_correlation_runs rows written by run_log_correlation()
-- from ones written by fill_log_correlation_gaps() - without this, a
-- gap-fill run (allow_reprocess = false, rows_inserted/rows_updated > 0,
-- resolved_parent_log_file_id null) is indistinguishable from an ordinary
-- correlation run that happened to insert/update rows.
alter table public.log_correlation_runs
  add column operation text not null default 'correlate'
    constraint log_correlation_runs_operation_check check (operation in ('correlate', 'gap_fill'));

comment on column public.log_correlation_runs.operation is
  'Which function wrote this row: ''correlate'' for run_log_correlation(), ''gap_fill'' for fill_log_correlation_gaps(). For gap_fill rows, rows_inserted counts inferred rows added (gap type B), rows_updated counts Bad_Read/blank rows corrected in place (gap type A), and rows_unresolved counts gaps skipped as ambiguous or wider than the configured max span - resolved_parent_log_file_id and parent_log_file_id_param are always null for gap_fill rows (they do not resolve a parent file themselves).';

comment on column public.log_correlations.child_log_file_id is
  'The camera1 log_files.id this row was produced for. Populated by run_log_correlation() for every row (real and, via fill_log_correlation_gaps(), inferred); lets gap-filling scope its work without relying on child_log_entry_id, which inferred rows do not have.';
comment on column public.log_correlations.is_inferred is
  'True for a row inserted by fill_log_correlation_gaps() to represent a camera1 sequence number with no backing log_entries row at all (gap type B). False for every row written by run_log_correlation() itself, whether or not usr_child_code/usr_parent_code have since been filled in (gap type A: a Bad_Read/blank placeholder corrected in place).';

comment on table public.log_correlations is
  'One row per camera1 log_entries row, ceiling-matched to its nearest camera2 parent code and resolved to its owning customer_sequence - plus, for is_inferred rows, a synthetic row for a sequence number with no camera1 log_entries row at all. Written by run_log_correlation(); child_log_entry_id is unique (among non-inferred rows) and is the upsert key. usr_child_code/usr_parent_code/usr_exclude_row/notes are user-entered data-quality corrections; fill_log_correlation_gaps() also writes usr_child_code/usr_parent_code for gaps it can resolve unambiguously, recording overridden_by = ''gap-fill'' (overridden_by is any other value, typically a user id/email, for a human correction) - overridden_by/overridden_at track who/what made a correction and when, separate from created_by/modified_by (which track the automated correlation run, not a correction).';
