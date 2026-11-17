-- Indexes log_correlations.parent_log_entry_id, the one foreign key on this
-- table with no index behind it.
--
-- child_log_entry_id has log_correlations_child_log_entry_id_key (unique) and
-- child_log_file_id has log_correlations_child_log_file_id_idx, but
-- parent_log_entry_id (added with the table in
-- 20260816120100_create_log_correlations.sql) never got one. Postgres checks a
-- referencing table on every delete of a referenced row, so deleting a single
-- public.log_entries row runs
--   select 1 from log_correlations where parent_log_entry_id = $1 for key share
-- as a sequential scan of the whole correlations table. Measured on a
-- developer database restored from production: ~21 ms and 8044 buffers per
-- row deleted, against 270k correlation rows.
--
-- That cost is paid per entry, so it scales with the file being removed: a
-- camera log file of 16k entries spends ~5.6 minutes purely on this check, and
-- a plain `delete from log_files` cascading to log_entries reliably exceeds the
-- statement timeout. Found while making scripts/test-log-correlation-gaps.ts
-- re-runnable (its cleanup timed out on exactly this), but it applies to any
-- log file deletion, not just test data.
--
-- Plain CREATE INDEX, not CONCURRENTLY: migrations run inside a transaction
-- block, which CONCURRENTLY cannot. This takes a brief ACCESS EXCLUSIVE lock
-- while it builds (well under a second at the current table size).
--
-- Nulls are indexed rather than excluded with a partial index. The column is
-- null for every row whose child read was a Bad_Read (run_log_correlation()
-- does not link a parent entry in that case) plus every is_inferred row, so a
-- partial index would be meaningfully smaller - but the full index also serves
-- "which correlation rows point at this parent entry" lookups, and the size
-- difference does not justify a second shape to reason about.
create index log_correlations_parent_log_entry_id_idx
  on public.log_correlations (parent_log_entry_id);

comment on index public.log_correlations_parent_log_entry_id_idx is
  'Backs the foreign-key check Postgres runs against log_correlations when a referenced public.log_entries row is deleted. Without it that check is a sequential scan per deleted entry, making deletion of any camera log file (which cascades to its entries) slow enough to hit the statement timeout.';
