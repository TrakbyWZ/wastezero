-- Views used by HTTP GET API routes. Abstraction layer so underlying SQL can change without affecting API calls.

-- GET /api/log-files: list of log files with duplicate_count
create or replace view public.vw_api_log_files_list
with (security_invoker = on)
as
select
  lf.id,
  lf.filename,
  lf.upload_timestamp,
  lf.total_reads,
  lf.bad_reads,
  lf.sequence_reads,
  lf.uploaded_by,
  coalesce(
    (select dc.duplicate_count
     from public.get_log_file_duplicate_counts() dc
     where dc.log_file_id = lf.id),
    0
  )::bigint as duplicate_count
from public.log_files lf;

comment on view public.vw_api_log_files_list is 'GET /api/log-files: log files with duplicate count. Order by upload_timestamp desc in API.';

-- GET /api/customers and GET /api/customers/[id]: customers with batch_count
create or replace view public.vw_api_customers_list
with (security_invoker = on)
as
select
  c.id,
  c.customer_num,
  c.customer_description,
  c.contact_email,
  c.is_active,
  c.created_date,
  (select count(*)::int from public.batch b where b.customer_id = c.id) as batch_count
from public.customer c;

comment on view public.vw_api_customers_list is 'GET /api/customers and /api/customers/[id]: customers with batch_count. Filter is_active and search q in API.';

-- GET /api/customers/[id]/sequence: latest sequence settings per customer (offset_sequence, label_prefix, number_format)
create or replace view public.vw_api_customer_sequence_for_customer
with (security_invoker = on)
as
select distinct on (cs.customer_id)
  cs.customer_id,
  cs.offset_sequence,
  cs.label_prefix,
  cs.number_format
from public.customer_sequence cs
order by cs.customer_id, cs.created_date desc nulls last;

comment on view public.vw_api_customer_sequence_for_customer is 'GET /api/customers/[id]/sequence: latest customer_sequence per customer.';

-- GET /api/customer-sequences and GET /api/customer-sequences/[id]: sequences with customer denormalized (API maps to nested customer object)
create or replace view public.vw_api_customer_sequences_list
with (security_invoker = on)
as
select
  cs.id,
  cs.customer_id,
  cs.label_prefix,
  cs.number_format,
  cs.attributes,
  cs.start_seq,
  cs.end_seq,
  cs.offset_sequence,
  cs.is_default,
  cs.created_by,
  cs.created_date,
  cs.modified_by,
  cs.modified_date,
  c.customer_num,
  c.customer_description
from public.customer_sequence cs
join public.customer c on c.id = cs.customer_id;

comment on view public.vw_api_customer_sequences_list is 'GET /api/customer-sequences and /api/customer-sequences/[id]. Order by created_date desc in API. Map customer_num/customer_description to nested customer in API.';

-- GET /api/batches: batches with customer and sequence denormalized (API maps to nested customer and customer_sequence objects)
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
  cs.number_format as sequence_number_format
from public.batch b
join public.customer c on c.id = b.customer_id
join public.customer_sequence cs on cs.id = b.customer_sequence_id;

comment on view public.vw_api_batches_list is 'GET /api/batches. Order and filter (q, from, to, customer) in API. Map to nested customer and customer_sequence in API.';
