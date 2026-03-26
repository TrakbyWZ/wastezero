CREATE OR REPLACE VIEW public.vw_customer_sequence_xref
with (security_invoker = on)
AS 
WITH header_file as (
  SELECT lef.*,
    le.*, 
    LAG(le.data_timestamp) OVER (PARTITION BY le.log_file_id ORDER BY le.data_timestamp) AS last_data_timestamp
  FROM public.log_entries le
  LEFT JOIN public.log_files lef
    ON lef.id = le.log_file_id
  WHERE le.log_file_header = 'Camera 2 Log File'
  and le.data_value NOT IN ('Bad_Read') and nullif(trim(le.data_value), '') IS NOT NULL
  -- ## For troubleshooting only, use the specific log_file_id
  -- and le.log_file_id = '23545f6e-d7f8-416b-a405-df1707c0a964'
)
SELECT 
  -- camera 1
  f.id as cam1_log_file_id,
  f.filename as cam1_filename,
  f.upload_timestamp as cam1_upload_timestamp,
  c1.log_file_header as cam1_log_file_header,
  c1.job_name as cam1_job_name,
  c1.operator as cam1_operator,
  c1.job_start_timestamp as cam1_job_start_timestamp,
  c1.job_end_timestamp as cam1_job_end_timestamp,
  c1.data_timestamp as cam1_data_timestamp,
  c1.data_value as cam1_data_value,
  c1.sort_order as cam1_sort_order,
  -- camera 2
  hf.log_file_id,
  hf.filename,
  hf.upload_timestamp,
  hf.log_file_header,
  hf.job_name,
  hf.operator,
  hf.job_start_timestamp,
  hf.job_end_timestamp,
  hf.data_timestamp,
  hf.last_data_timestamp,
  hf.data_value,
  hf.sort_order,
  cs.customer_id,
  cs.label_prefix,
  cs.id as customer_sequence_id,
  c.customer_num,
  c.customer_description
FROM public.log_entries c1
INNER JOIN public.log_files f
  ON f.id = c1.log_file_id
INNER JOIN public.customer_sequence cs
  ON c1.data_value LIKE cs.label_prefix || '%'
  AND c1.data_value ~ ('^' || cs.label_prefix || '\d{' || LENGTH(cs.number_format)::text || '}$')
INNER JOIN public.customer c
  ON c.id = cs.customer_id
LEFT JOIN header_file hf
  ON c1.data_timestamp >= COALESCE(hf.last_data_timestamp, hf.job_start_timestamp) 
  AND c1.data_timestamp < hf.data_timestamp
WHERE c1.data_value NOT IN ('Bad_Read') 
and nullif(c1.data_value, ' ') IS NOT NULL 
and c1.log_file_header = 'Camera 1 Log File'
-- ## For troubleshooting only, use the specific log_file_id
-- and c1.log_file_id = 'b4af29ed-5773-4447-816c-dc82be502ac4'
ORDER BY c1.data_timestamp;