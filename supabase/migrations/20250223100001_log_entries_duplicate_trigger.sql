-- Set-based duplicate flag: join log_entries to itself on data_value; if any other row
-- (different id) has the same data_value, then is_duplicate = true.
-- Call this procedure after uploading new log entries (e.g. from API after insert).

create or replace function public.flag_log_entries_duplicates()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Use a single update with a window function to determine duplicates
  update public.log_entries e
  set is_duplicate = sub.has_duplicates
  from (
    select 
      id, 
      count(*) over (partition by data_value) > 1 as has_duplicates
    from public.log_entries
    where data_value not in ('Bad Read', 'Bad_Read', '') or data_value is null
  ) sub
  where e.id = sub.id
  and e.data_value not in ('Bad Read', 'Bad_Read', '') or e.data_value is null;
end;
$$;

comment on function public.flag_log_entries_duplicates() is 'Updates is_duplicate for all entries in a single pass using a window function.';