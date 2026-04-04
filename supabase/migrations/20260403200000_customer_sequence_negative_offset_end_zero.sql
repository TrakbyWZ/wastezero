-- Descending sequences (negative offset) must end at 0.

update public.customer_sequence
set end_seq = 0
where offset_sequence is not null
  and offset_sequence < 0
  and end_seq is distinct from 0;

alter table public.customer_sequence
  add constraint customer_sequence_negative_offset_end_zero
  check (
    offset_sequence is null
    or offset_sequence >= 0
    or end_seq = 0
  );

comment on constraint customer_sequence_negative_offset_end_zero on public.customer_sequence is
  'Negative offset (descending) requires end_seq = 0.';
