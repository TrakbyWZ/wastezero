-- Return duplicate count per log file for the main Data Logs table.

create or replace function public.get_log_file_duplicate_counts()
returns table(log_file_id uuid, duplicate_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select le.log_file_id, count(*)::bigint
  from public.log_entries le
  where le.is_duplicate = true
  group by le.log_file_id;
$$;

comment on function public.get_log_file_duplicate_counts() is 'Returns (log_file_id, duplicate_count) for each log file; used by Data Logs list API.';
