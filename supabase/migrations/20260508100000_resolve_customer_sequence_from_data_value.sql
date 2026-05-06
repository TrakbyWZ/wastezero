-- Resolve customer_sequence_id and numeric suffix from log_entries.data_value using the same
-- Cam-1 regex rules as customer_sequence_cam1_data_value_regex (label_prefix + number_format).

create or replace function public.resolve_customer_sequence_from_data_value(p_data_value text)
returns table(customer_sequence_id uuid, sequence_number bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with normalized as (
    select nullif(trim(p_data_value), '') as v
  ),
  eligible as (
    select n.v
    from normalized n
    where n.v is not null
      and n.v not in ('Bad Read', 'Bad_Read')
  ),
  matches as (
    select
      cs.id as cs_id,
      cs.number_format as nf,
      e.v as dv,
      char_length(coalesce(cs.label_prefix, '')) as prefix_len
    from eligible e
    inner join public.customer_sequence cs
      on e.v ~ public.customer_sequence_cam1_data_value_regex(cs.label_prefix, cs.number_format)
  ),
  picked as (
    select
      m.cs_id,
      length(nullif(trim(m.nf), ''))::integer as n_digits,
      m.dv
    from matches m
    order by m.prefix_len desc, m.cs_id asc
    limit 1
  )
  select
    p.cs_id as customer_sequence_id,
    case
      when p.n_digits > 0 and right(p.dv, p.n_digits) ~ '^[0-9]+$' then (right(p.dv, p.n_digits))::bigint
      else null::bigint
    end as sequence_number
  from picked p;
$$;

comment on function public.resolve_customer_sequence_from_data_value(text) is
  'From a Camera-style data_value, finds the best-matching customer_sequence (longest label_prefix wins on ties) and parses the trailing fixed-width digits from number_format as int8; returns no rows if no match.';

-- Populate log_entries.customer_sequence_id / sequence_number for one row (scalar subquery → NULLs when no match).

create or replace function public.apply_customer_sequence_to_log_entry(p_log_entry_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.log_entries le
  set
    customer_sequence_id = x.customer_sequence_id,
    sequence_number = x.sequence_number
  from (
    select
      le2.id,
      r.customer_sequence_id,
      r.sequence_number
    from public.log_entries le2
    left join lateral public.resolve_customer_sequence_from_data_value(le2.data_value) r on true
    where le2.id = p_log_entry_id
  ) x
  where le.id = x.id;
$$;

comment on function public.apply_customer_sequence_to_log_entry(uuid) is
  'Sets customer_sequence_id and sequence_number on one log_entries row from its data_value.';

create or replace function public.apply_customer_sequence_to_log_file_entries(p_log_file_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.log_entries le
  set
    customer_sequence_id = x.customer_sequence_id,
    sequence_number = x.sequence_number
  from (
    select
      le2.id,
      r.customer_sequence_id,
      r.sequence_number
    from public.log_entries le2
    left join lateral public.resolve_customer_sequence_from_data_value(le2.data_value) r on true
    where le2.log_file_id = p_log_file_id
  ) x
  where le.id = x.id;
$$;

comment on function public.apply_customer_sequence_to_log_file_entries(uuid) is
  'Sets customer_sequence_id and sequence_number for all log_entries rows belonging to one log file.';
