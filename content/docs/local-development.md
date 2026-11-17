# Local development

This page is **only** for running WasteZero on **your computer**: local **Supabase** (Docker), the **Next.js** app, and **in-app help** under **Help & Docs** in the navigation. It does not cover **production** deploys, **GitHub** release flow, or **hosted** Supabase/Vercel (see [System overview](./architecture.md) and [Users, GitHub, Supabase, and Vercel](./admin-platforms.md)).

**After reading this, you should know:** how to install dependencies, point `.env.local` at local or hosted Supabase, reset the local database from migrations, start the app and open it in the browser, and open help from the signed-in app.

---

## What runs where (local)

| What | URL / process |
| ---- | -------------- |
| **Next.js** (main app) | `http://localhost:3000` — `pnpm dev` (or the tail end of `pnpm run dev:full`) |
| **Local Supabase** (Postgres, Auth, Studio) | `http://127.0.0.1:54321` and related ports — `pnpm exec supabase start` |
| **In-app help** | `http://localhost:3000/protected/docs/...` when signed in; source lives in `content/docs/*.md` and hot-reloads with `pnpm dev`. |

---

## Prerequisites

- **Node.js** 18+ and [pnpm](https://pnpm.io)
- **Git**
- For **local database**: [Docker](https://docker.com) and the [Supabase CLI](https://supabase.com/docs/guides/cli) (`pnpm exec supabase` after install)

---

## 1. Clone and install

```bash
git clone https://github.com/TrakbyWZ/wastezero.git
cd wastezero
pnpm install
```

---

## 2. Environment (`.env.local`)

Copy the example and fill in values (names must match `lib/` — see [App structure — environment variables](./app-structure-and-database.md#environment-variables-typical)):

```bash
cp .env.example .env.local
```

**Minimum to run the app (hosted or local Supabase), aligned with the repo’s `lib/` usage:**

| Variable | Notes |
| -------- | ----- |
| `SUPABASE_URL` | From the [Supabase Dashboard](https://app.supabase.com) (hosted) or `pnpm exec supabase status` (local). |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key. |
| `SUPABASE_SECRET_KEY` | **Service role** key — **server only**; never in client bundles. Read by `lib/supabase/admin.ts` (if your `supabase status` output or `.env.example` used another name, copy the service role **value** into this variable so it matches the code). |
| `SESSION_SECRET` | Random string for session cookies (e.g. `openssl rand -base64 32`). |

Add any other variables your team uses (see the root **`.env.example`**) as needed. Optional: `MS_*` for real outgoing email (app-sent mail and password resets) via Microsoft Graph — see [Email Setup](./email-setup.md) to wire up the client's Office 365 tenant. If `MS_*` is not set, emails are logged to the **dev server** console instead of sent. Optional: `LOG_FILES_INGEST_API_KEY` to exercise `/api/log-files/ingest` with `X-API-Key` (for example from the **.NET** Windows upload service against `http://localhost:3000`). Configure the worker with **`appsettings.Development.json`** (copy from `appsettings.Development.json.example`, gitignored) and matching **`UploadService:ApiKey`** — full steps are in [Windows Upload Service](./windows-upload-service.md).

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

### Working from a copy of production data

`db reset` gives you migrations plus `seed.sql`. When you need to reproduce something against real data instead, restore a production dump onto local:

```bash
pnpm db:refresh:local   # db:backup --linked, then db:restore --local --latest --yes
```

`db:restore` **drops and recreates the local `postgres` database**, and refuses anything but `--local` by design — it never writes to a linked or remote project.

Two things are not in that dump, and both will stop you cold if you skip them:

- **Auth users.** The dump covers the **`public`** schema only, so restoring empties **`auth.users`** while `public.users` keeps its allow-listed emails. Login is OTP-only against Supabase Auth, so with no Auth users you simply cannot sign in — the app looks broken, with nothing wrong in the app. Rebuild them from `public.users`:

  ```bash
  pnpm create-users --local
  ```

  Any `supabase/seed.sql` dev users are gone too; `create-users` reads `public.users`, which the dump *does* restore.

- **Migrations newer than production.** A dump carries production's schema, so anything in `supabase/migrations/` not yet pushed is missing. Do **not** use `db reset` to apply it — that rebuilds from migrations and `seed.sql` and throws the restored data away. Use:

  ```bash
  pnpm db:migrate:local   # --dry-run first to see the plan
  ```

  It marks versions already applied on the linked project as applied (without re-running their SQL), then applies only the local-only ones.

So a full "work against production data" cycle is: `db:refresh:local` → `db:migrate:local` → `create-users --local`.

A restored dump is real customer data. Keep it local, and remember that test scripts under `scripts/` seed and delete rows in the same database.

### Local Studio

Open **Supabase Studio** for the local project from the CLI (URL is listed in `supabase status`) to browse tables, SQL, and Auth for debugging.

### OTP and allow-listed users (local)

- Seeded / test users for local dev are typically defined in **`supabase/seed.sql`**. If you change the seed, run `pnpm exec supabase db reset` so they are reapplied.  
- **If you cannot sign in after restoring a production dump**, `auth.users` is empty — the dump only carries the `public` schema. Run `pnpm create-users --local`; see [Working from a copy of production data](#working-from-a-copy-of-production-data).  
- Without outgoing SMTP, use the code shown in the **dev server** terminal.  
- The app’s access rules still use `public.users` and Supabase Auth (see [App structure](./app-structure-and-database.md) and the allow-list in `lib/supabase/proxy.ts`).

---

## 4. Run the Next.js app

```bash
pnpm dev
```

Open the app: **[http://localhost:3000](http://localhost:3000)** (or the host/port Next prints).

### One command: Supabase + app

**`dev:full`** restarts the local **Supabase** stack, then runs the Next.js dev server. Help content is part of the app (Markdown under `content/docs/`).

```bash
pnpm run dev:full
```

---

## 5. In-app documentation

Help and developer pages are **Markdown** files in **`content/docs/`**, rendered as **`/protected/docs/...`** routes inside the same Next.js app (same top navigation, theme, and sign-in as the rest of the product). You must be **signed in** to view them, same as the other protected pages.

- Edit `content/docs/<slug>.md` and save; reload the page in the browser to see changes.
- Page titles and the left-hand outline come from `lib/docs/config.ts`.
- Screenshot images for the **Quick Start Guide** page live in **`public/docs-images/`** and are referenced in Markdown as e.g. `/docs-images/help-menu.png`.
- If your deployment used older **`/docs/...`** paths, `next.config.ts` may define redirects to **`/protected/docs/...`** (see the file in the repo).

---

## 6. Checklist before you file an issue

- [ ] `pnpm install` completed with no error at repo root.  
- [ ] `.env.local` exists and matches a running Supabase (local `status` or hosted project).  
- [ ] `pnpm exec supabase db reset` (local) or equivalent applied migrations.  
- [ ] If you restored a production dump instead: `pnpm db:migrate:local` applied the local-only migrations, and `pnpm create-users --local` recreated the Auth users (otherwise sign-in fails with `auth.users` empty).  
- [ ] `pnpm dev` (or `pnpm run dev:full`) running and the browser target matches your env (e.g. `http://localhost:3000`).

For **repository layout**, key names, and RLS, continue with [App structure, Supabase connection, and database construction](./app-structure-and-database.md). For **production** GitHub / Vercel / hosted Supabase operations, use [Users, GitHub, Supabase, and Vercel](./admin-platforms.md).
