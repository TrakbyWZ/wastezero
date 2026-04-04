-- Include customer_sequence_id so API can filter batches by selected sequence.
create or replace view public.vw_api_batches_list
with (security_invoker = on)
as
select
  b.id,
  b.customer_id,
  b.created_date,
  b.start_time,
  b.end_time,
  b.start_sequence,
  b.end_sequence,
  b.offset_sequence,
  b.label_count,
  b.filename,
  c.customer_num,
  c.customer_description,
  cs.label_prefix as sequence_label_prefix,
  cs.number_format as sequence_number_format,
  b.customer_sequence_id
from public.batch b
join public.customer c on c.id = b.customer_id
join public.customer_sequence cs on cs.id = b.customer_sequence_id;

comment on view public.vw_api_batches_list is 'GET /api/batches. Order and filter (q, from, to, customer, customer_sequence) in API. Map to nested customer and customer_sequence objects.';
