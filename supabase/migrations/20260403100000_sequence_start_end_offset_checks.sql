-- customer_sequence + batch: offset/direction checks, number_format default 00000000,
-- backfills, and start_seq floor when end_seq is null.

-- --- Offset and start/end direction (null components skip check) ---

alter table public.customer_sequence
  add constraint customer_sequence_offset_nonzero
  check (offset_sequence is null or offset_sequence <> 0);

alter table public.customer_sequence
  add constraint customer_sequence_start_end_offset_direction
  check (
    offset_sequence is null
    or start_seq is null
    or end_seq is null
    or (offset_sequence > 0 and end_seq >= start_seq)
    or (offset_sequence < 0 and end_seq <= start_seq)
  );

comment on constraint customer_sequence_offset_nonzero on public.customer_sequence is
  'Step between sequence values cannot be zero.';

comment on constraint customer_sequence_start_end_offset_direction on public.customer_sequence is
  'Ascending sequences (positive offset) need end_seq >= start_seq; descending (negative offset) need end_seq <= start_seq.';

alter table public.batch
  add constraint batch_offset_nonzero
  check (offset_sequence is null or offset_sequence <> 0);

alter table public.batch
  add constraint batch_start_end_offset_direction
  check (
    offset_sequence is null
    or start_sequence is null
    or end_sequence is null
    or (offset_sequence > 0 and end_sequence >= start_sequence)
    or (offset_sequence < 0 and end_sequence <= start_sequence)
  );

comment on constraint batch_offset_nonzero on public.batch is
  'Step between sequence values cannot be zero.';

comment on constraint batch_start_end_offset_direction on public.batch is
  'Ascending batches (positive offset) need end_sequence >= start_sequence; descending need end_sequence <= start_sequence.';

-- --- Defaults, data cleanup, unbounded-end start floor ---

alter table public.customer_sequence
  alter column number_format set default '00000000';

update public.customer_sequence
set number_format = '00000000'
where number_format is null or trim(number_format) = '';

update public.customer_sequence
set start_seq = 1
where start_seq is null;

alter table public.customer_sequence
  add constraint customer_sequence_start_min_when_unbounded_end
  check (end_seq is not null or start_seq is null or start_seq >= 0);

comment on constraint customer_sequence_start_min_when_unbounded_end on public.customer_sequence is
  'When end_seq is null (no upper bound), start_seq must be null (DB default 1) or >= 0.';
