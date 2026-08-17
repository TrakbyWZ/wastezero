# Log Correlation Review & Publish — Roadmap

Status: approved (customer-facing scoping; implementation plans written per phase)
Related docs: `content/docs/data-correlation.md` (source requirement), `docs/superpowers/specs/2026-08-16-log-file-data-correlation-design.md` (existing read-only correlation engine/API this builds on)
Branch: `feat/scheduled-file-processing`

## Problem

`log_correlations` (schema + scheduled correlation job + `GET /api/log-correlations`) already exists and is read-only. Operations eventually needs a **data quality process** on top of it: QC staff review correlated records, fix or flag rows the algorithm got wrong or couldn't resolve, and then **publish** a reviewed set of records to a chosen customer via email. The customer wants to sequence this deliberately: get the correlation data itself solid and visible first (it already is), get it into the reporting tool operations already uses, and only then design the review/edit/publish workflow in detail.

## Constraints that shape this roadmap

- One part-time developer, working alongside other responsibilities — near-term estimates assume roughly 2-3 focused days/week, not dedicated full-time weeks.
- No transactional email provider exists today (confirmed: nothing for this app, nothing reusable from elsewhere). `lib/email.ts` / `/api/email/send` exist in code but are unused dead paths — SMTP creds aren't confirmed configured, and raw SMTP from a serverless host (Vercel) is not a reliable production path anyway. This is a known dependency for whatever the eventual "publish" mechanism turns out to be, not something to solve now.
- A Power BI report template (`powerbi/TrakbyWz_Reports.pbit`, from the `create-qa-reports` work) already exists, but nothing in the migrations sets up a dedicated read-only database role for it — it likely prompts for connection parameters on open today rather than using a scoped credential.

## Sequencing (confirmed with the customer)

1. **Correlation tables first** — the data engine itself, already built.
2. **Wire it up to Power BI** — get operations looking at real correlated data in the tool they already use, before any custom UI exists.
3. **Then** discuss reviewing/editing records and publishing them to customers — deliberately not scoped in detail yet; revisit once Power BI is in use and real usage patterns are visible.

## Phase 0 — Correlation tables (done)

**Status: already built**, no further roadmap work needed here.

- `log_correlations` / `log_correlation_runs` tables, `run_log_correlation()` function, `pg_cron` schedule (every 10 min, insert-only), and `vw_api_log_correlations` view are all in place (migrations `20260816120000`–`20260816120400`).
- `GET /api/log-correlations` exposes it (session-authenticated), with `job_name`/`job_number`/`customer_id`/`from`/`to` filters and pagination.
- Per the existing design spec, this phase deliberately excludes any UI, CSV export, or edit path — those are exactly what's being deferred to step 3 above.

## Phase 1 — Wire up Power BI

**Goal:** operations can see real, correlated child/parent/customer/job data in the existing Power BI report, without any new application code.

- Connect `powerbi/TrakbyWz_Reports.pbit` (or a new page within it) to `vw_api_log_correlations`, which already denormalizes the fields a QC-style report needs: `child_code`, `parent_code`, both timestamps, `job_name`/`job_number`/`job_date`, and customer fields (`customer_num`/`customer_description`) via its join to `customer`.
- Create a dedicated, least-privilege Postgres role for Power BI's connection (`SELECT` on `vw_api_log_correlations` only, or on a small set of existing `vw_api_*` views) rather than handing Power BI a service-role or admin credential — this is a small migration (`CREATE ROLE` + `GRANT SELECT`), not new schema.
- Decide and configure refresh cadence (Power BI scheduled refresh vs. DirectQuery) — DirectQuery keeps it live given the 10-minute correlation sweep, Import is simpler operationally but goes stale between refreshes. Recommend DirectQuery unless there's a reason to avoid live connections from Power BI to the production database (e.g. licensing/connection-limit constraints Power BI Desktop vs. Service may impose) — flag this as a decision to confirm once account details.
- Validate: filter by customer/job in the report and confirm figures match `GET /api/log-correlations` for the same filters.

**Estimate:** ~1-1.5 effort-weeks → ~2-3 calendar weeks part-time, mostly Power BI/DB configuration rather than app code.

## Phase 2 — Review, edit, and publish workflow (to be scoped)

**Deliberately not detailed yet.** Once Power BI is in use, revisit this with the customer to confirm the shape below still holds before committing to a timeline. Carried forward as candidate scope from earlier discussion, not yet approved for implementation:

- **Edit scope (candidate):** QC corrects a wrong auto-resolved parent/customer match, and/or excludes a row with a reason (kept for audit, out of any published export).
- **Publish scope (candidate):** scoped to one customer + job/date range, tracked (who/when/what rows/recipients) to prevent accidental re-sends.
- **Recipients (candidate):** a `customer` field holding one or more semicolon-delimited email addresses.
- **Known open dependency regardless of design:** no transactional email provider exists yet (see Constraints above) — provisioning one and verifying a sending domain is on the critical path for any automated "send" step, whenever that's scoped.

No timeline is committed for this phase — it depends on decisions not yet made (e.g., whether publish stays Power-BI-export-plus-manual-email indefinitely, or a custom in-app review/publish UI gets built, and if so how much of it).

## Explicitly deferred / open items

- Phase 2's scope, phasing, and timeline — explicitly punted to a follow-up discussion per the customer's request.
- Power BI DirectQuery vs. Import decision, and the exact least-privilege grant set for its role — to be finalized during Phase 1 implementation.
- Email provider selection — open, not on the critical path until Phase 2 is scoped and if it turns out to require automated sending.
