-- Maintain running eligible (non-empty, non-bad-read) row counts per data_value so
-- duplicate flagging does not aggregate over the full log_entries table each ingest.
-- Counts are updated by statement-level triggers on INSERT/DELETE; finalize only reads
-- counts and sets is_duplicate / log_files.duplicate_count.

create table public.log_entry_eligible_value_counts (
  data_value text not null,
  cnt bigint not null,
  constraint log_entry_eligible_value_counts_pkey primary key (data_value),
  constraint log_entry_eligible_value_counts_cnt_nonnegative check (cnt >= 0)
);

comment on table public.log_entry_eligible_value_counts is
  'Running count of eligible log_entries per data_value (excludes empty and Bad Read values); drives duplicate detection without full-table scans.';

insert into public.log_entry_eligible_value_counts (data_value, cnt)
select
  le.data_value,
  count(*)::bigint
from public.log_entries le
where nullif(trim(le.data_value), '') is not null
  and le.data_value not in ('Bad Read', 'Bad_Read')
group by le.data_value;

alter table public.log_entry_eligible_value_counts enable row level security;

create policy "Service role only: log_entry_eligible_value_counts"
  on public.log_entry_eligible_value_counts for all
  using (false)
  with check (false);

create or replace function public.increment_eligible_value_counts_from_inserted_log_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  with deltas as (
    select
      le.data_value,
      count(*)::bigint as delta
    from inserted_rows le
    where nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
    group by le.data_value
  )
  insert into public.log_entry_eligible_value_counts (data_value, cnt)
  select d.data_value, d.delta
  from deltas d
  on conflict (data_value) do update
  set cnt = public.log_entry_eligible_value_counts.cnt + excluded.cnt;

  return null;
end;
$$;

create or replace function public.decrement_eligible_value_counts_from_deleted_log_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  with deltas as (
    select
      le.data_value,
      count(*)::bigint as delta
    from deleted_rows le
    where nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
    group by le.data_value
  )
  update public.log_entry_eligible_value_counts c
  set cnt = c.cnt - d.delta
  from deltas d
  where c.data_value = d.data_value;

  delete from public.log_entry_eligible_value_counts
  where cnt <= 0;

  return null;
end;
$$;

create trigger trg_log_entries_increment_eligible_counts
after insert on public.log_entries
referencing new table as inserted_rows
for each statement
execute function public.increment_eligible_value_counts_from_inserted_log_entries();

create trigger trg_log_entries_decrement_eligible_counts
after delete on public.log_entries
referencing old table as deleted_rows
for each statement
execute function public.decrement_eligible_value_counts_from_deleted_log_entries();

create or replace function public.flag_log_entries_duplicates_for_file(p_log_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with affected_values as (
    select distinct le.data_value
    from public.log_entries le
    where le.log_file_id = p_log_file_id
      and nullif(trim(le.data_value), '') is not null
      and le.data_value not in ('Bad Read', 'Bad_Read')
  ),
  value_counts as (
    select
      av.data_value,
      c.cnt as total_count
    from affected_values av
    inner join public.log_entry_eligible_value_counts c
      on c.data_value = av.data_value
  ),
  affected_log_file_ids as (
    select distinct le.log_file_id
    from public.log_entries le
    inner join affected_values av
      on av.data_value = le.data_value
    union
    select p_log_file_id
  ),
  updated_duplicates as (
    update public.log_entries e
    set is_duplicate = (vc.total_count > 1)
    from value_counts vc
    where e.data_value = vc.data_value
      and nullif(trim(e.data_value), '') is not null
      and e.data_value not in ('Bad Read', 'Bad_Read')
      and e.is_duplicate is distinct from (vc.total_count > 1)
    returning e.log_file_id
  ),
  duplicate_counts as (
    select
      le.log_file_id,
      count(*)::integer as duplicate_count
    from public.log_entries le
    where le.is_duplicate = true
      and le.log_file_id in (
        select afl.log_file_id
        from affected_log_file_ids afl
      )
    group by le.log_file_id
  )
  update public.log_files lf
  set duplicate_count = coalesce(dc.duplicate_count, 0)
  from affected_log_file_ids afl
  left join duplicate_counts dc
    on dc.log_file_id = afl.log_file_id
  where lf.id = afl.log_file_id;
end;
$$;

comment on function public.flag_log_entries_duplicates_for_file(uuid) is
  'Sets is_duplicate from log_entry_eligible_value_counts and refreshes log_files.duplicate_count for affected files.';

comment on function public.increment_eligible_value_counts_from_inserted_log_entries() is
  'Statement-level trigger: upserts eligible per–data_value deltas after log_entries inserts.';

comment on function public.decrement_eligible_value_counts_from_deleted_log_entries() is
  'Statement-level trigger: subtracts eligible per–data_value deltas after log_entries deletes.';
