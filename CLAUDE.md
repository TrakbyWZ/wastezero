# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WasteZero (Trak) is a Next.js (App Router) app for managing production batches, customers, customer sequences, and printer/camera log ingestion. It uses Supabase (Postgres + Auth) for data, OTP (passwordless) login, and a separate on-premises .NET Windows service that uploads log files to this app's ingest API.

In-app product/developer docs live in `content/docs/` and are rendered at `/protected/docs/...` for signed-in users — these are more detailed than this file for architecture, Supabase connection details, and admin/deploy operations:
- `content/docs/architecture.md` — system-level topology (GitHub/Supabase/Vercel/Windows service)
- `content/docs/app-structure-and-database.md` — repo structure, Supabase client patterns, migration workflow
- `content/docs/local-development.md` — local dev setup
- `content/docs/windows-upload-service.md` — .NET upload service setup/ops
- `supabase/README.md` — migration commands and the `vw_api_*` view → route mapping

## Commands

```bash
pnpm dev              # Start Next.js dev server
pnpm run dev:full     # Stop/start local Supabase (Docker), then pnpm dev
pnpm build            # Production build
pnpm start            # Run production server
pnpm lint             # ESLint (next/core-web-vitals + next/typescript)

pnpm test:sequence              # Run lib/sequence.ts tests (scripts/test-sequence.ts)
pnpm test:log-parser            # Run lib/log-parser.ts tests (scripts/test-log-parser.ts)
pnpm test:log-ingest-pressure   # Pressure-test log ingestion (scripts/pressure-test-log-ingest.ts)

pnpm create-users     # Create a Supabase Auth user from scripts/create-user.ts

pnpm db:backup --local | --linked | --db-url [...]   # Dump Postgres to backups/ (gitignored)
pnpm db:restore --local --file <path> | --latest [--yes]  # Restore onto LOCAL Supabase only
pnpm db:refresh:local   # db:backup --linked + db:restore --local --latest --yes, chained (requires `supabase link` first)
```

There is no top-level test framework — `test:sequence` and `test:log-parser` are standalone `tsx` scripts (not jest/vitest); run them directly with `pnpm exec tsx scripts/test-sequence.ts` if iterating on a single case. There is no `test:*` script for `lib/log-ingest.ts` beyond the pressure test.

Local Supabase (requires Docker + Supabase CLI):
```bash
pnpm exec supabase start        # start local stack
pnpm exec supabase status -o env   # get local URL/keys for .env.local
pnpm exec supabase db reset     # re-apply all migrations + seed.sql from scratch
pnpm exec supabase migration new <name>   # create a new timestamped migration file
```

## Architecture

**Layering:** `app/api/*` route handlers are the only supported way for the browser to reach privileged data — many tables have RLS that blocks `anon`/`authenticated` roles entirely, so server code uses the **service-role** admin client (`lib/supabase/admin.ts`) and the browser never talks to those tables directly. `vw_api_*` Postgres views (defined in migrations) sit between raw tables and GET routes so schema can evolve without breaking API shape; see the table in `supabase/README.md` for the current view → route mapping.

**Three Supabase client factories in `lib/supabase/`, use the right one:**
- `client.ts` — browser, publishable key, for client components.
- `server.ts` — SSR, publishable key + request cookies (`@supabase/ssr`), for server components/route handlers that need the signed-in user's session.
- `admin.ts` — service role (`SUPABASE_SECRET_KEY`), server-only, bypasses RLS. Never import into client components.

**Auth is custom, not Supabase Auth sessions in cookies directly:** `lib/session.ts` signs/verifies an HMAC session cookie (`app.session`) independent of Supabase's own session cookie. Login is OTP-only — there is no sign-up flow; allowed emails are pre-provisioned in `public.users` (and `supabase/seed.sql` for local dev). After editing the seed, run `supabase db reset`.

**Sequence/label generation (`lib/sequence.ts`) is a pure, dependency-free module** — arithmetic progression math (start/offset/count/end), zero-padding, `%TOKEN%` date-prefix interpolation, and CSV formatting all live here with no DB or API coupling. `createBatchLabelCsvReadableStream` streams large batches without materializing a `number[]` (avoids OOM on big `label_count`); prefer it over `generateSequence` + `formatSequenceToCsv` for anything that could be large. `MAX_BATCH_LABEL_COUNT` (9,999,999) is an application-level cap, not enforced by the DB column type alone.

**Log ingestion (`lib/log-ingest.ts` + `lib/log-parser.ts`):** `parseDetailLog` parses raw printer/camera detail-log text into records; `ingestLogFile` inserts a `log_files` row then bulk-inserts `log_entries` in chunks of 1000 via the admin client. If entry insertion fails partway, the `log_files` row is deleted (no orphaned/partial file records) and the error rethrown — don't add entries without preserving this rollback. Filenames are unique; duplicate-filename inserts surface Postgres `23505` and get mapped to a 409 `IngestValidationError`. Payload caps: 10 MB raw text, 100,000 records — these throw `IngestValidationError` before any DB write. Duplicate-entry tracking (`is_duplicate`, related triggers/materialized counts) was removed in the `20260518*` migrations to streamline ingest — don't reintroduce per-entry duplicate flagging without checking whether that decision still holds.

**Migrations are the schema source of truth** (`supabase/migrations/`, timestamp-prefixed, applied in filename order). Never edit an already-applied migration — add a new timestamped file (`supabase migration new <name>`). Local dev picks up new migrations via `supabase db reset`; hosted environments apply them via `supabase db push` after `supabase link`.

**Windows upload service (`windows-upload-service-dotnet/`)** is a separate .NET solution, not part of the Next.js build/deploy. It never talks to Supabase — it only POSTs files to this app's `/api/log-files/ingest` with a shared API key (`LOG_FILES_INGEST_API_KEY` here, `UploadService:ApiKey` in its own `appsettings.json`/env). Edit its code only under `windows-upload-service-dotnet/src/`; edit its user-facing docs only in `content/docs/windows-upload-service.md`, not in `windows-upload-service-dotnet/README.md` (that file just points here).

**Route conventions:** `app/*/_components/` holds non-routable UI private to that route segment (vs. shared UI in top-level `components/`). `app/protected/` requires a valid session (checked via `lib/session.ts`); `app/auth/` and `app/login/` are the pre-auth OTP flow.

## Gotchas / things that have bitten this repo before

- **Env var name mismatch:** top-level `README.md` documents `SUPABASE_SERVICE_ROLE_KEY`, but the actual code (`lib/supabase/admin.ts`) reads `process.env.SUPABASE_SECRET_KEY`. `.env.example` lists both `SUPABASE_SERVICE_ROLE_KEY` and an unprefixed `SECRET_KEY`, neither of which is the literal name the code checks. If admin-client calls fail locally with "Missing SUPABASE_URL or SUPABASE_SECRET_KEY", check the actual env var name in `lib/supabase/admin.ts` rather than trusting the docs/`.env.example` naming.
- **`pnpm db:restore --local` drops and recreates the local `postgres` database.** It refuses anything but `--local` by design (never touches linked/remote) — do not try to add a non-local restore path without preserving that guard.
- **Don't back-fill duplicate-entry tracking on `log_entries`** — it was deliberately removed for ingest performance/simplicity (see migrations `20260518120000`–`20260518140000`).
