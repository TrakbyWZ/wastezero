---
sidebar_label: Local development
---

# Local development

This page is **only** for running WasteZero on **your computer**: local **Supabase** (Docker), the **Next.js** app, and the embedded **docs** at `/docs`. It does not cover **production** deploys, **GitHub** release flow, or **hosted** Supabase/Vercel (see [System Overview](./architecture.md) and [Users, GitHub, Supabase, and Vercel](./admin-platforms.md)).

**After reading this, you should know:** how to install dependencies, point `.env.local` at local or hosted Supabase, reset the local database from migrations, start the app and open it in the browser, and see help at `/docs`.

---

## What runs where (local)

| What | URL / process |
|------|----------------|
| **Next.js** (main app) | `http://localhost:3000` — `pnpm dev` (or the tail end of `pnpm run dev:full`) |
| **Local Supabase** (Postgres, Auth, Studio) | `http://127.0.0.1:54321` and related ports — `pnpm exec supabase start` |
| **Docusaurus only** (optional) | e.g. `http://localhost:3001` — `pnpm run docs:start` in the monorepo; use when you want **hot reload** for Markdown without rebuilding. The **integrated** docs path for daily work is: build Docusaurus → `public/docs` → served as **`/docs`** on the same origin as the app (see below). |

---

## Prerequisites

- **Node.js** 18+ and [pnpm](https://pnpm.io)
- **Git**
- For **local database**: [Docker](https://docker.com) and the [Supabase CLI](https://supabase.com/docs/guides/cli) (`pnpm exec supabase` after install)

---

## 1. Clone and install

```bash
git clone <your-repo-url>
cd wastezero
pnpm install
```

Install runs at the **repository root** (monorepo); it covers the main app and the `docs-site` package as needed for builds.

---

## 2. Environment (`.env.local`)

Copy the example and fill in values (names must match `lib/` — see [App structure — environment variables](./app-structure-and-database.md#environment-variables-typical)):

```bash
cp .env.example .env.local
```

**Minimum to run the app (hosted or local Supabase), aligned with the repo’s `lib/` usage:**

| Variable | Notes |
|----------|--------|
| `SUPABASE_URL` | From the [Supabase Dashboard](https://app.supabase.com) (hosted) or `pnpm exec supabase status` (local). |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key. |
| `SUPABASE_SECRET_KEY` | **Service role** key — **server only**; never in client bundles. Read by `lib/supabase/admin.ts` (if your `supabase status` output or `.env.example` used another name, copy the service role **value** into this variable so it matches the code). |
| `SESSION_SECRET` | Random string for session cookies (e.g. `openssl rand -base64 32`). |

Add any other variables your team uses (see the root **`.env.example`**) as needed. Optional: SMTP and `OTP_FROM_EMAIL` for real one-time login emails. If SMTP is not set, **OTP codes are printed in the dev server** terminal. Optional: `LOG_FILES_INGEST_API_KEY` to exercise `/api/log-files/ingest` with `X-API-Key`.

---

## 3. Supabase on your machine

### Start the stack (Docker)

```bash
pnpm exec supabase start
```

### Get connection details for `.env.local`

```bash
pnpm exec supabase status -o env
```

Merge the printed `SUPABASE_URL`, keys, etc. into `.env.local` (same variable names the app already uses).

### Apply schema and sample data (typical for first run)

Migrations in `supabase/migrations/` are the **source of truth**. A full local reset runs migrations and `seed.sql`:

```bash
pnpm exec supabase db reset
```

- **When you change a migration** during development, run `db reset` again (or the workflow you use) so local Postgres matches.  
- CLI details and `db push` for remote projects live in `supabase/README.md` in the repository (remote deploy is also covered in [admin-platforms](./admin-platforms.md)).

### Local Studio

Open **Supabase Studio** for the local project from the CLI (URL is listed in `supabase status`) to browse tables, SQL, and Auth for debugging.

### OTP and allow-listed users (local)

- Seeded / test users for local dev are typically defined in **`supabase/seed.sql`**. If you change the seed, run `pnpm exec supabase db reset` so they are reapplied.  
- Without outgoing SMTP, use the code shown in the **dev server** terminal.  
- The app’s access rules still use `public.users` and Supabase Auth (see [App structure](./app-structure-and-database.md) and the proxy allow-list in `lib/supabase/proxy.ts`).

---

## 4. Run the Next.js app

```bash
pnpm dev
```

Open the app: **[http://localhost:3000](http://localhost:3000)** (or the host/port Next prints).

### One command: Supabase + docs + dev server

To **restart** local Supabase, run a full **Docusaurus** production build, copy the output into **`public/docs`**, and then start the dev server:

```bash
pnpm run dev:full
```

Use this when you want **integrated `/docs`** in the same process as the app without a separate Docusaurus port. The Docusaurus build can take a minute; day-to-day `pnpm dev` is faster if you are not changing docs.

---

## 5. In-app documentation (`/docs`)

The help site is a **Docusaurus** build copied into `public/docs` and served as **`/docs`** on the same origin as the app (e.g. `http://localhost:3000/docs/`). You must have built and copied at least once, or use `dev:full` above.

| Need | Command (repo root) |
|------|---------------------|
| **One-off** build + copy | `pnpm run docs:build && pnpm run docs:sync` |
| **Production** pipeline | `pnpm run build` (includes docs before `next build`) |

**Hot reload** while editing **Markdown** only: from the repo root, `pnpm run docs:start` runs Docusaurus (often on **port 3001** so it does not clash with Next on **3000**). That is a **standalone** docs site; the **in-app** experience is still `http://localhost:3000/docs/` after build + sync. More context: `docs-site/README.md` in the repository.

**Note (navbar “Back to TrakByWz App”):** the docs build uses `NEXT_PUBLIC_SITE_URL` (or, on Vercel, `VERCEL_URL`) to point that link at the app’s **public origin** (see `docs-site/docusaurus.config.js`). For local `docs:build` without those variables, the default is `http://localhost:3000`, so the link matches the app on the usual dev port. Set `NEXT_PUBLIC_SITE_URL` if you use a different base URL (e.g. `https://localhost:3000` or another host).

---

## 6. Checklist before you file an issue

- [ ] `pnpm install` completed with no error at repo root.  
- [ ] `.env.local` exists and matches a running Supabase (local `status` or hosted project).  
- [ ] `pnpm exec supabase db reset` (local) or equivalent applied migrations.  
- [ ] `pnpm dev` (or `pnpm run dev:full`) running and the browser target matches your env (e.g. `http://localhost:3000`).

For **repository layout**, key names, and RLS, continue with [App structure, Supabase connection, and database construction](./app-structure-and-database.md). For **production** GitHub / Vercel / hosted Supabase operations, use [Users, GitHub, Supabase, and Vercel](./admin-platforms.md).
