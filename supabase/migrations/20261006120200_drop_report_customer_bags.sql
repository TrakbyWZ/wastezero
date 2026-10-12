-- Deprecates the Customer Bags report: it solved the same problem
-- log_correlations/the Quality Control page now solve (attributing a
-- camera1 child code to its camera2 parent/header value), via an older
-- time-interval-bucketing algorithm with no review/edit workflow. The
-- app-facing page and API routes (app/protected/reports/customer-bags,
-- app/api/reports/customer-bags/*) and the "Reports" nav section are
-- removed in this same change. report_customer_bags is a precomputed
-- cache derivable from log_entries - nothing irreplaceable is lost by
-- dropping it; refresh_customer_bags_report_full() already hadn't been
-- called from ingest since 20260518140000_drop_finalize_log_file_ingest.sql
-- removed its only automatic caller.
drop function if exists public.refresh_customer_bags_report_for_log_file(uuid);
drop function if exists public.refresh_customer_bags_report_full();
drop table if exists public.report_customer_bags;
