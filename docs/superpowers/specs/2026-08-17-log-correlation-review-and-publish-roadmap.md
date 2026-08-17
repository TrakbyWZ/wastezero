# Log Correlation Review & Publish — Roadmap

Status: approved (customer-facing scoping; implementation plans written per phase)
Related docs: `content/docs/data-correlation.md` (source requirement), `docs/superpowers/specs/2026-08-16-log-file-data-correlation-design.md` (existing read-only correlation engine/API this builds on)
Branch: `feat/scheduled-file-processing`

## Problem

`log_correlations` (schema + scheduled correlation job + `GET /api/log-correlations`) already exists and is read-only. Operations now needs a **data quality process**: QC staff review correlated records, fix or flag rows the algorithm got wrong or couldn't resolve, and then **publish** a reviewed set of records to a chosen customer via email. The customer wants this available in an interim, low-engineering form immediately, with a fully automated, in-app version to follow.

## Constraints that shape this roadmap

- One part-time developer, working alongside other responsibilities — timeline assumes roughly 2-3 focused days/week, not dedicated full-time weeks.
- No transactional email provider exists today (confirmed: nothing for this app, nothing reusable from elsewhere). `lib/email.ts` / `/api/email/send` exist in code but are unused dead paths — SMTP creds aren't confirmed configured, and raw SMTP from a serverless host (Vercel) is not a reliable production path anyway. Real sending requires provisioning a provider (Resend/SendGrid/Postmark/SES) and verifying a sending domain (SPF/DKIM), which has calendar-time lead (DNS propagation/provider review), not just engineering time.
- An existing Power BI report (from the `create-qa-reports` work) already reads correlation-adjacent data and can serve as the interim reporting surface with little to no new engineering.

## Scope decisions (confirmed with the customer)

- **Edit scope:** QC can (a) correct an incorrectly auto-resolved `parent_log_entry_id`/`customer_id` on a `log_correlations` row, and (b) exclude/flag a row (e.g. known bad read, test run) without deleting it, with a reason, so it's kept out of any published export but stays in the audit trail.
- **Publish scope:** a publish is scoped to one customer + a job/date range, and is tracked (who/when/what rows/what recipients) so the same rows aren't accidentally re-sent.
- **Recipients:** a new field on `customer` holding one or more email addresses, semicolon-delimited (supports multiple recipients per customer).
- **Interim output:** the existing Power BI report, manually filtered/exported, manually emailed — no new engineering required to start this.

## Phase 0 — Interim manual process

**Goal:** give QC a working (if manual) publish path within days, covering the gap until Phase 3 ships.

- Confirm/adjust the Power BI dataset backing the existing report so it surfaces `child_code`, `parent_code`, `job_name`/`job_number`/`job_date`, `customer_description`, and both timestamps from `vw_api_log_correlations`.
- QC filters the report to a customer/job, exports CSV/Excel, and manually emails it using whatever contact info ops has today (the `customer.contact_emails` field from Phase 1 will formalize this later).
- No app deploy required. Runs continuously in parallel with Phases 1-4.

**Estimate:** 2-3 days to verify/adjust the report; effectively immediate.

## Phase 1 — Data model foundation

**Goal:** the schema needed for review, exclusion, and publish-tracking, with no UI yet.

- Migration: `customer.contact_emails text` (semicolon-delimited).
- Migration: `log_correlations` gains `is_excluded boolean default false`, `exclusion_reason text`, `excluded_by`, `excluded_at` — independent of the existing algorithmic `modified_by`/`modified_timestamp`, since exclusion is a review annotation, not a resolution change.
- Human edits to `parent_log_entry_id`/`customer_id`/`customer_sequence_id` reuse the existing `log_correlation_runs` audit table: a lightweight row with `triggered_by = 'manual-edit:<email>'` is inserted per edit, and `log_correlations.modified_by` points at it — this keeps one audit mechanism instead of a parallel one, and the existing table's `triggered_by` column already anticipated a `'manual:<email>'` shape.
- New table `log_correlation_publications`: `id`, `customer_id`, job/date scope (or explicit row list), `published_at`, `published_by`, `recipient_emails` (snapshot at publish time), `status` (`draft`/`sent`/`failed`), `row_count`. A batch-marker FK on `log_correlations` (or a join table) records which rows were included in which publication, so an already-published row is visibly not re-publishable by accident.
- Extend `vw_api_log_correlations` (or add a sibling view) to expose exclusion/publication status for the UI built in Phase 2.

**Estimate:** ~1.5-2 effort-weeks → ~3-4 calendar weeks part-time.

## Phase 2 — Review & edit UI

**Goal:** QC can review, correct, and exclude records without SQL access.

- New authenticated page under `app/protected/` (e.g. `/protected/log-correlations`): paginated, filterable (job/customer/date) table, reusing/extending `GET /api/log-correlations`.
- Inline edit for a wrong parent/customer resolution; exclude-with-reason action.
- New `PATCH`/similar API route(s) implementing the manual-edit-as-run audit pattern from Phase 1, with validation.

**Estimate:** ~2.5-3 effort-weeks → ~5-6 calendar weeks part-time.

## Phase 3 — In-app publish (still manually emailed)

**Goal:** retire Power BI as the export mechanism; formalize "already published" tracking, while sending stays a manual, human-in-the-loop step.

- "Publish" action: QC picks a customer + job/date scope; the system snapshots the in-scope, non-excluded rows into a `log_correlation_publications` batch and generates a downloadable CSV matching the shape documented in `content/docs/data-correlation.md` ("Final Expected Result").
- QC downloads the CSV and sends it manually to the customer's `contact_emails` (Phase 1) using their normal mail client.
- Already-published rows/batches are visibly flagged so QC can't accidentally re-publish the same scope.

**Estimate:** ~1.5-2 effort-weeks → ~3-4 calendar weeks part-time.

## Phase 4 — Full automation (system sends the email)

**Goal:** "Publish" sends the email itself; no more manual export/attach/send.

- Pick and provision a transactional email provider — recommend **Resend** for a Next.js/Vercel stack (simple API, generous free tier); SendGrid/Postmark/SES are acceptable alternatives if there's an existing organizational preference.
- Verify a sending domain (SPF/DKIM DNS records) — this has calendar-time lead (DNS propagation, provider review) that runs in parallel with, not blocking, Phases 1-3.
- Replace the manual-send step: "Publish" generates the CSV attachment and sends it to every address in `recipient_emails`, updates `log_correlation_publications.status` to `sent`/`failed`, with basic retry and failure visibility (e.g. surfaced in the UI, not just logs).

**Estimate:** ~1.5-2.5 effort-weeks engineering → ~3-5 calendar weeks part-time, including provider setup lead time.

## Overall timeline

| Phase | Deliverable | Calendar estimate (part-time solo) |
|---|---|---|
| 0 | Interim manual publish via Power BI | Days, starts immediately |
| 1 | Schema: edit/exclude/publish audit, customer emails | ~3-4 weeks |
| 2 | Review & edit UI | ~5-6 weeks |
| 3 | In-app publish + CSV export, manual send | ~3-4 weeks |
| 4 | Automated email send | ~3-5 weeks |
| **Total (1-4)** | | **~14-19 weeks (~3.5-4.5 months)** |

Phase 0 is live within the first week and covers the gap throughout. Meaningful in-app capability (review, edit, exclude, export — no more Power BI) lands around the Phase 3 mark, roughly 8-10 weeks in; full hands-off automation follows after Phase 4.

## Explicitly deferred / open items

- **Email provider selection is an open decision** — no provider exists today; this is on Phase 4's critical path and should be raised with the customer as a dependency, not assumed solved.
- Exact CSV export column shape should be re-confirmed against `content/docs/data-correlation.md`'s "Final Expected Result" table before Phase 3 implementation.
- No scheduled/automatic publishing (e.g. "auto-publish nightly") — publish stays a human-triggered action in every phase, since the point of this process is human review before external send.
- No handling yet for what happens if a `log_correlations` row is edited *after* it's already been included in a `sent` publication — flagged for the Phase 2/3 implementation plans to resolve explicitly, not decided here.
