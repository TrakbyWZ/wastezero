/**
 * Shared types used by API routes and UI. Colocated here per Next.js
 * project structure: keep app for routing, shared code in lib.
 */

export type BatchRow = {
  id: string;
  created_date: string | null;
  start_time: string | null;
  end_time: string | null;
  start_sequence: number | null;
  end_sequence: number | null;
  offset_sequence: number | null;
  label_count: number | null;
  filename: string | null;
  customer: {
    customer_num: string;
    customer_description: string | null;
  } | null;
  /** Customer sequence applied to this batch (label prefix & number format) */
  customer_sequence: {
    label_prefix: string | null;
    number_format: string | null;
  } | null;
};

export type CustomerRow = {
  id: string;
  customer_num: string;
  customer_description: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_date: string | null;
  batch_count?: number;
};

export type CustomerDetail = {
  id: string;
  customer_num: string;
  customer_description: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_date: string | null;
  batch_count: number;
};

/** Row from customer_sequence table (list with customer joined) */
export type CustomerSequenceRow = {
  id: string;
  customer_id: string;
  customer: {
    customer_num: string;
    customer_description: string | null;
  } | null;
  label_prefix: string | null;
  number_format: string | null;
  attributes: Record<string, unknown> | null;
  start_seq: number | null;
  end_seq: number | null;
  offset_sequence: number | null;
  is_default: boolean | null;
  created_by: string | null;
  created_date: string | null;
  modified_by: string | null;
  modified_date: string | null;
};

/** Row from log_files table (for list and preview file summary) */
export type LogFileRow = {
  id: string;
  filename: string;
  upload_timestamp: string;
  total_reads: number;
  bad_reads: number;
  sequence_reads: number;
  /** Materialized duplicate count maintained on public.log_files */
  duplicate_count: number;
  uploaded_by: string | null;
};
