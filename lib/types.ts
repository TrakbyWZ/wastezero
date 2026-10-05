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
  /** True when at least one batch references this sequence */
  used_in_batch?: boolean;
};

/** Row from log_files table (for list and preview file summary) */
export type LogFileRow = {
  id: string;
  filename: string;
  upload_timestamp: string;
  total_reads: number;
  bad_reads: number;
  sequence_reads: number;
  uploaded_by: string | null;
};

/** Row from vw_api_log_correlation_files (Quality Control list screen) */
export type LogCorrelationFileRow = {
  child_log_file_id: string;
  child_filename: string;
  job_name: string | null;
  job_number: string | null;
  job_date: string;
  customer_id: string | null;
  customer_num: string | null;
  customer_description: string | null;
  total_count: number;
  unresolved_count: number;
  excluded_count: number;
  inferred_count: number;
  last_row_created_at: string;
  last_correlate_run_at: string | null;
  last_correlate_run_status: string | null;
  last_gap_fill_run_at: string | null;
  last_gap_fill_run_status: string | null;
};

/** Row from vw_api_log_correlations (Quality Control detail screen row table) */
export type LogCorrelationRow = {
  id: string;
  child_log_entry_id: string | null;
  parent_log_entry_id: string | null;
  child_code: string | null;
  parent_code: string | null;
  child_code_timestamp: string | null;
  parent_code_timestamp: string | null;
  job_name: string | null;
  job_number: string | null;
  job_date: string;
  customer_id: string | null;
  customer_sequence_id: string | null;
  child_operator: string | null;
  child_filename: string | null;
  parent_operator: string | null;
  parent_filename: string | null;
  customer_num: string | null;
  customer_description: string | null;
  usr_child_code: string | null;
  usr_parent_code: string | null;
  usr_exclude_row: boolean;
  notes: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  created_timestamp: string;
  modified_timestamp: string;
  child_sort_order: number | null;
  parent_sort_order: number | null;
  is_inferred: boolean;
  effective_child_code: string | null;
  effective_parent_code: string | null;
  child_log_file_id: string;
};

/** Row from log_correlation_runs (Quality Control detail screen run history) */
export type LogCorrelationRunRow = {
  id: string;
  run_started_at: string;
  run_completed_at: string | null;
  triggered_by: string;
  allow_reprocess: boolean;
  operation: "correlate" | "gap_fill";
  child_log_file_id_param: string;
  parent_log_file_id_param: string | null;
  resolved_parent_log_file_id: string | null;
  rows_inserted: number;
  rows_updated: number;
  rows_unresolved: number;
  status: "running" | "succeeded" | "failed";
  error_message: string | null;
};
