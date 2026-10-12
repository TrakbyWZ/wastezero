-- Re-creates fill_log_correlation_gaps() (originally from
-- 20261005120200_create_fill_log_correlation_gaps.sql) to also record the
-- parent file it resolved onto its own log_correlation_runs row
-- (resolved_parent_log_file_id) - previously computed into v_parent_log_file_id
-- and used to ceiling-match filled codes, but never persisted, so the
-- Quality Control detail screen's run-history "Parent File" column (added
-- in 20261006120100_add_parent_file_info.sql) always showed "—" for
-- gap_fill runs even when one was found. run_log_correlation() already
-- does this for its own 'correlate' runs; this brings gap_fill runs to
-- parity.
create or replace function public.fill_log_correlation_gaps(
  p_child_log_file_id uuid,
  p_triggered_by text default 'cron',
  p_allow_refill boolean default false,
  p_max_gap_span integer default 1000
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
  v_rows_skipped integer := 0;
  v_parent_log_file_id uuid;
  rec record;
  prev record;
  v_missing bigint;
  v_prefix text;
  v_digit_width integer;
  v_placeholder_count integer;
  v_span_rec record;
  v_fill_num bigint;
  v_fill_code text;
  v_parent_code text;
  v_row_count integer;
  v_has_prev boolean := false;
  i integer;
begin
  if p_child_log_file_id is null then
    raise exception 'p_child_log_file_id is required';
  end if;

  insert into public.log_correlation_runs (
    triggered_by, allow_reprocess, child_log_file_id_param, operation
  ) values (
    p_triggered_by, p_allow_refill, p_child_log_file_id, 'gap_fill'
  )
  returning id into v_run_id;

  begin
    -- Whichever camera2 file the correlation pass actually resolved for
    -- this child file, found via an already-resolved row's real parent
    -- linkage (not log_correlation_runs, so this still works if that run's
    -- audit row is ever pruned). Null means nothing in this file has
    -- resolved a parent yet, so filled codes get no usr_parent_code
    -- instead of a guess.
    select le_parent.log_file_id
    into v_parent_log_file_id
    from public.log_correlations lc
    join public.log_entries le_parent on le_parent.id = lc.parent_log_entry_id
    where lc.child_log_file_id = p_child_log_file_id
    limit 1;

    -- Recorded on this run's own audit row (same column run_log_correlation()
    -- uses for its 'correlate' runs) so the Quality Control run-history
    -- panel can show which parent file a gap_fill run actually used,
    -- instead of always showing "—" for this operation kind.
    update public.log_correlation_runs
    set resolved_parent_log_file_id = v_parent_log_file_id
    where id = v_run_id;

    for rec in
      select
        lc.id,
        lc.usr_child_code,
        lc.usr_exclude_row,
        lc.overridden_by,
        lc.job_name,
        lc.job_number,
        lc.job_date,
        coalesce(lc.usr_child_code, lc.child_code) as effective_code,
        le.sort_order as child_sort_order
      from public.log_correlations lc
      join public.log_entries le on le.id = lc.child_log_entry_id
      where lc.child_log_file_id = p_child_log_file_id
        and lc.is_inferred = false
      order by le.sort_order
    loop
      -- A "known" row is one whose effective code (usr_child_code if a
      -- prior correction/fill set one, else the raw child_code) is a
      -- genuine, parseable sequence value - not Bad_Read/blank. Only known
      -- rows can bound a gap; unresolved placeholders are left for the gap
      -- check below to find between two known bounds.
      if rec.effective_code is not null
         and rec.effective_code <> 'Bad_Read'
         and nullif(trim(rec.effective_code), '') is not null
         and rec.effective_code ~ '\d+$'
      then
        -- v_has_prev is checked in its own IF, never combined into one
        -- boolean expression with prev.* below: PL/pgSQL plans an
        -- expression referencing a record field as a whole, so even a
        -- short-circuited "v_has_prev and ...prev.effective_code..." would
        -- fail to plan on the very first (prev-unassigned) iteration. A
        -- separate nested IF means that reference is never even parsed
        -- until prev has been assigned at least once.
        if v_has_prev then
        if regexp_replace(rec.effective_code, '\d+$', '') = regexp_replace(prev.effective_code, '\d+$', '')
        then
          v_missing := substring(rec.effective_code from '(\d+)$')::bigint
                     - substring(prev.effective_code from '(\d+)$')::bigint - 1;

          if v_missing > 0 and v_missing <= p_max_gap_span then
            v_prefix := regexp_replace(prev.effective_code, '\d+$', '');
            v_digit_width := length(substring(prev.effective_code from '(\d+)$'));

            -- Total count of rows physically occupying this span, eligible
            -- or not: every row here is already known to be an unresolved
            -- placeholder (a known/resolved row in this span would itself
            -- have become a bound, interrupting prev/rec), so no
            -- usr_exclude_row/overridden_by filter belongs in this count -
            -- it answers "is every missing number's slot physically
            -- present", not "how many can we write to".
            select count(*)
            into v_placeholder_count
            from public.log_correlations lc2
            join public.log_entries le2 on le2.id = lc2.child_log_entry_id
            where lc2.child_log_file_id = p_child_log_file_id
              and lc2.is_inferred = false
              and le2.sort_order > prev.child_sort_order
              and le2.sort_order < rec.child_sort_order;

            if v_placeholder_count = v_missing then
              -- Gap type A: a placeholder row physically exists for every
              -- missing number - walk them in position order assigning the
              -- next number in sequence to each slot, but only write the
              -- correction to rows eligible to be auto-filled. A row a
              -- human already excluded, or already touched (and
              -- p_allow_refill is false), still occupies its slot in the
              -- numbering but is left untouched - it does not make the gap
              -- type B, since the slot is not actually empty.
              v_fill_num := substring(prev.effective_code from '(\d+)$')::bigint;
              for v_span_rec in
                select lc2.id, lc2.usr_exclude_row, lc2.overridden_by
                from public.log_correlations lc2
                join public.log_entries le2 on le2.id = lc2.child_log_entry_id
                where lc2.child_log_file_id = p_child_log_file_id
                  and lc2.is_inferred = false
                  and le2.sort_order > prev.child_sort_order
                  and le2.sort_order < rec.child_sort_order
                order by le2.sort_order
              loop
                v_fill_num := v_fill_num + 1;

                if v_span_rec.usr_exclude_row = false and (p_allow_refill or v_span_rec.overridden_by is null) then
                  v_fill_code := v_prefix || lpad(v_fill_num::text, greatest(v_digit_width, length(v_fill_num::text)), '0');
                  v_parent_code := null;

                  if v_parent_log_file_id is not null then
                    select p2.data_value into v_parent_code
                    from public.log_entries p2
                    where p2.log_file_id = v_parent_log_file_id
                      and p2.log_file_header = 'Camera 2 Log File'
                      and p2.data_value <> 'Bad_Read'
                      and nullif(trim(p2.data_value), '') is not null
                      and regexp_replace(p2.data_value, '\d+$', '') = v_prefix
                      and substring(p2.data_value from '(\d+)$')::bigint >= v_fill_num
                    order by substring(p2.data_value from '(\d+)$')::bigint asc
                    limit 1;
                  end if;

                  update public.log_correlations
                  set
                    usr_child_code = v_fill_code,
                    usr_parent_code = v_parent_code,
                    overridden_by = 'gap-fill',
                    overridden_at = now(),
                    modified_timestamp = now(),
                    modified_by = v_run_id
                  where id = v_span_rec.id;
                  v_rows_updated := v_rows_updated + 1;
                end if;
              end loop;
            elsif v_placeholder_count = 0 then
              -- Gap type B: no row at all for the missing number(s) -
              -- insert a synthetic inferred row for each one.
              v_fill_num := substring(prev.effective_code from '(\d+)$')::bigint;
              for i in 1 .. v_missing loop
                v_fill_num := v_fill_num + 1;
                v_fill_code := v_prefix || lpad(v_fill_num::text, greatest(v_digit_width, length(v_fill_num::text)), '0');
                v_parent_code := null;

                if v_parent_log_file_id is not null then
                  select p2.data_value into v_parent_code
                  from public.log_entries p2
                  where p2.log_file_id = v_parent_log_file_id
                    and p2.log_file_header = 'Camera 2 Log File'
                    and p2.data_value <> 'Bad_Read'
                    and nullif(trim(p2.data_value), '') is not null
                    and regexp_replace(p2.data_value, '\d+$', '') = v_prefix
                    and substring(p2.data_value from '(\d+)$')::bigint >= v_fill_num
                  order by substring(p2.data_value from '(\d+)$')::bigint asc
                  limit 1;
                end if;

                insert into public.log_correlations (
                  child_log_file_id, usr_child_code, usr_parent_code, is_inferred,
                  job_name, job_number, job_date, overridden_by, overridden_at,
                  created_by, modified_by
                ) values (
                  p_child_log_file_id, v_fill_code, v_parent_code, true,
                  prev.job_name, prev.job_number, prev.job_date, 'gap-fill', now(),
                  v_run_id, v_run_id
                )
                on conflict (child_log_file_id, usr_child_code) where is_inferred do nothing;

                get diagnostics v_row_count = row_count;
                if v_row_count > 0 then
                  v_rows_inserted := v_rows_inserted + 1;
                end if;
              end loop;
            else
              -- Ambiguous: some but not all of the missing numbers have a
              -- placeholder row present - can't tell with confidence which
              -- placeholder maps to which missing number, so the whole gap
              -- is skipped rather than guessed at.
              v_rows_skipped := v_rows_skipped + 1;
            end if;
          elsif v_missing > p_max_gap_span then
            v_rows_skipped := v_rows_skipped + 1;
          end if;
        end if;
        end if;

        prev := rec;
        v_has_prev := true;
      end if;
    end loop;

    update public.log_correlation_runs
    set
      run_completed_at = now(),
      status = 'succeeded',
      rows_inserted = v_rows_inserted,
      rows_updated = v_rows_updated,
      rows_unresolved = v_rows_skipped
    where id = v_run_id;
  exception when others then
    -- Same rationale as run_log_correlation(): never re-raise, so the audit
    -- row recording the failure is not itself rolled back.
    update public.log_correlation_runs
    set run_completed_at = now(), status = 'failed', error_message = sqlerrm
    where id = v_run_id;
  end;

  return v_run_id;
end;
$$;

comment on function public.fill_log_correlation_gaps(uuid, text, boolean, integer) is
  'Fills gaps in one already-correlated child file''s camera1 sequence: Bad_Read/blank rows bracketed by two good reads get usr_child_code set to the inferred number (gap type A), and missing numbers with no row at all get a synthetic is_inferred row inserted (gap type B). Only fills a gap when the count of unresolved placeholder rows between its two bounds exactly equals the numeric span - leading/trailing gaps, prefix changes, partially-placeholdered gaps, and gaps wider than p_max_gap_span are all skipped (counted in rows_unresolved) rather than guessed at. p_allow_refill must be explicitly true to revisit a row some prior correction/fill already touched (usr_child_code set, or overridden_by non-null); the default (used by the scheduled sweep) only touches untouched placeholders. Writes usr_parent_code via the same ceiling-match used by run_log_correlation(), using whichever camera2 file the correlation pass already resolved for this child file - left null if nothing in the file has resolved a parent yet; that same file id is also recorded on this run''s own resolved_parent_log_file_id, matching run_log_correlation()''s convention for its own runs. Never raises for expected or unexpected failures, for the same reason as run_log_correlation(): callers must check the returned run''s status/error_message on log_correlation_runs.';

-- Corrects log_correlation_runs.operation's comment (originally from
-- 20261005120000_add_log_correlation_gap_fill_support.sql): it used to say
-- resolved_parent_log_file_id is "always null for gap_fill rows", which is
-- no longer true now that fill_log_correlation_gaps() records it above.
comment on column public.log_correlation_runs.operation is
  'Which function wrote this row: ''correlate'' for run_log_correlation(), ''gap_fill'' for fill_log_correlation_gaps(). For gap_fill rows, rows_inserted counts inferred rows added (gap type B), rows_updated counts Bad_Read/blank rows corrected in place (gap type A), and rows_unresolved counts gaps skipped as ambiguous or wider than the configured max span. resolved_parent_log_file_id is populated the same way for both operations (whichever camera2 file was found/used, null if none); parent_log_file_id_param is always null for gap_fill rows - that function takes no parent-file override.';
