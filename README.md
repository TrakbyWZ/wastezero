# WasteZero

A Next.js app for managing production batches, customers, and printer logs. Supports sequence-based label CSV generation and OTP (passwordless) authentication.

## Features

- **Batch management** — Create, search, and filter batches; generate and download sequence CSV files by customer and date range.
- **Customers** — Manage customer records and per-customer sequence configuration (offset, next start).
- **Printer logs** — Ingest and view synced printer detail logs (job name, read counts, bad reads).
- **Auth** — OTP (one-time code) login via email; session in cookies; optional SMTP for real emails.
- **UI** — App Router, Tailwind CSS, Radix/shadcn-style components, light/dark theme.

## Tech stack

- [Next.js](https://nextjs.org) (App Router), [React](https://react.dev) 19
- [Supabase](https://supabase.com) (Postgres, Auth, local or hosted)
- [Tailwind CSS](https://tailwindcss.com), [Radix UI](https://www.radix-ui.com/)–based components
- [nodemailer](https://nodemailer.com) for OTP emails (optional)

## Project structure

- **`app/`** — Routes and route handlers: `page.tsx`, `layout.tsx`, `loading.tsx`, `not-found.tsx`; `api/` for API routes; `auth/` for login and password lifecycle (no sign-up; users are pre-authorized); `protected/` for authenticated pages (batch, customers, logs).
- **Documentation** — Docusaurus in **`docs-site/`**; build output is copied to **`public/docs`**, so help is at **`/docs`** on the app. **Local dev** (Supabase, env, `dev:full`, `/docs`) is documented in **`docs-site/docs/local-development.md`** in the repo and, after a docs build, under **For Developers → Local development** in `/docs`. Run `pnpm docs:build && pnpm docs:sync` before `pnpm dev` if you need `/docs` without `pnpm run dev:full`, or see `docs-site/README.md`.
- **`app/*/_components/`** — Private (non-routable) UI for a route segment (e.g. `protected/batch/_components/`).
- **`components/`** — Shared UI (forms, buttons, cards, theme switcher).
- **`lib/`** — Utilities, Supabase client/server/admin, session, email, sequence logic, log parser, shared types (`lib/types.ts`).
- **`supabase/`** — Migrations, seed, and config for local/hosted Supabase (see [supabase/README.md](supabase/README.md)).

## Getting started

### Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io) (or npm/yarn)
- For local Supabase: [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker

### Install and run

1. Clone the repo and install dependencies:

   ```bash
   pnpm install
   ```

2. Copy environment variables and set values (see [Environment variables](#environment-variables)):

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your Supabase URL, keys, and optional SMTP/OTP settings.
   ```

3. Run the app:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000). With local Supabase (see below), use `pnpm run dev:full` to restart Supabase, build and sync Docusaurus into `public/docs`, then start the dev server.

### Environment variables

Use `.env.local` (from `.env.example`). Main variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/publishable key |
| `SESSION_SECRET` | Yes | Secret for session cookies (e.g. `openssl rand -base64 32`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (for OTP and server-only APIs) |
| `SMTP_*`, `OTP_FROM_EMAIL` | No | SMTP for OTP emails; if unset, code is printed in the dev server console |
| `SYNCED_FILES_INGEST_API_KEY` | No | If set, ingest API expects `X-API-Key` header |

### Local Supabase

To run against a **local** Supabase instance:

1. Start Supabase (requires Docker):

   ```bash
   pnpm exec supabase start
   ```

2. Get local URL and keys:

   ```bash
   pnpm exec supabase status -o env
   ```

3. Put the output into `.env.local` (or merge with existing). You need at least:
   - `SUPABASE_URL` (e.g. `http://127.0.0.1:54321`)
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

4. Run the app: `pnpm dev`, or use `pnpm run dev:full` to restart Supabase, build and sync docs, then start the dev server.

**OTP login (local):**

- Allowed users are defined in `supabase/seed.sql`. After changing the seed, run `pnpm exec supabase db reset`.
- Without SMTP config, the one-time code is printed in the **terminal** where `pnpm dev` is running.
- To send real OTP emails, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (and optionally `SMTP_SECURE`, `OTP_FROM_EMAIL`) in `.env.local`.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start Next.js dev server |
| `pnpm run dev:full` | Stop/start local Supabase, `docs:build` + `docs:sync`, then `pnpm dev` |
| `pnpm build` | Production build |
| `pnpm start` | Run production server |
| `pnpm lint` | Run ESLint |
| `pnpm test:sequence` | Run sequence lib tests |
| `pnpm test:log-parser` | Run log parser tests |

## Database and migrations

Schema and migrations live in `supabase/migrations/`. See [supabase/README.md](supabase/README.md) for:

- Applying migrations locally (`supabase start` / `supabase db reset`)
- Pushing migrations to a hosted project (`supabase link` and `supabase db push`)

## Deploying

Build and run as a standard Next.js app. Ensure your host has the same environment variables set (Supabase URL and keys, `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and optional SMTP / ingest API key). For Vercel, you can use the [Supabase integration](https://vercel.com/integrations/supabase) to attach URL and keys to the project.
