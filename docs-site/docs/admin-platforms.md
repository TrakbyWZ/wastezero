# Users, GitHub, Supabase, and Vercel

This page covers **adding people to the app** and how to work in **GitHub**, **Supabase**, and **Vercel** for operations and deployment. For **app folder layout, Supabase clients, and how migrations build the database**, see [App structure, Supabase connection, and database construction](./app-structure-and-database.md). For a high-level **deployment** diagram, see [Architecture & operations](./architecture.md).

---

## Adding a user to the application

WasteZero does **not** allow open self-registration. Access is controlled by an **allow-list** in the PostgreSQL table `public.users` plus a matching user in **Supabase Auth**.

### What you need

- **Email** (unique) and **display name** for the person.
- **Database access** with permission to insert into `public.users` (Supabase **SQL Editor** or **Table Editor** as a privileged user, or a migration run by your team).
- **Service role** credentials locally if you use the script: `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local` (or `.env.prod.local` for production).

### Steps (typical)

1. **Add the allow-list row** in `public.users` with at least:
   - `email` — normalized to lowercase in app logic; store consistently (e.g. `user@company.com`).
   - `display_name` — shown in the app.
   - `is_active` — `true` so middleware allows access (see `lib/supabase/proxy.ts` in the repo for the allow-list check).
   - `is_admin` — `true` only for administrators, if your product uses that flag.

   You can do this in the Supabase **SQL Editor** (see below), e.g.:

   ```sql
   insert into public.users (email, display_name, is_active, is_admin, needs_password_reset)
   values ('new.user@example.com', 'New User', true, false, true);
   ```

   Or use the **Table Editor** → `users` → insert row (dashboard uses elevated access).

2. **Create the Supabase Auth user** so they can sign in. The repository includes a script that reads every row in `public.users` and creates Auth users with a shared initial password from your env:

   ```bash
   # Set in .env.local (or environment): WZ_PASSWORD=<initial password>
   pnpm create-users --local
   ```

   Use `--linked` instead of `--local` if you pointed env at a **production** file (e.g. `.env.prod.local`).

   - If the email **already exists** in Auth, the script **skips** that row.
   - Set `WZ_PASSWORD` to a strong **temporary** password; users with `needs_password_reset = true` are typically forced through your password-reset flow (see app behavior in production).

3. **Tell the user** to open the app URL, sign in with that email and password, and complete any **password reset** / onboarding your deployment requires.

### Local development seed

For local Supabase, sample users can live in `supabase/seed.sql`. After changes, run `pnpm exec supabase db reset` so the seed is reapplied. That only affects **local** databases — not production.

### Why two places (DB + Auth)?

- **`public.users`** — allow-list, active flag, app profile metadata; enforced by server-side checks.
- **Supabase Auth** — identity and sign-in. The `create-users` script keeps them aligned for each email in `public.users`.

---

## Navigating the GitHub repository

| Where | What to use it for |
|--------|--------------------|
| **Code** | Browse `app/`, `lib/`, `supabase/migrations/`, `.github/workflows/`. |
| **Pull requests** | Review app and schema changes before merge. |
| **Actions** | **CI** runs (see below), including database deploy when relevant. |
| **Settings → Secrets and variables** | **Actions** secrets used by workflows (e.g. Supabase deploy). Not the same as Vercel’s env vars. |
| **Settings → branches** | Branch protection (require reviews, required status checks). |

**Typical URL:** `https://github.com/<YOUR_ORG>/<REPO_NAME>` (replace with your org and repository).

**Important for deployment**

- Merging to **`main`** usually triggers a **Vercel production deployment** if the project is connected to this repo.
- Pushes that **only** change the app can go live without touching the database.
- **Database** changes are applied by **migrations** and your team’s process (Supabase CLI / GitHub Action — see below). Do **not** rely on Vercel to run SQL.

---

## CI/CD: database deploy from GitHub

This repository includes a workflow **`.github/workflows/deploy-db.yml`** that can deploy the Supabase **database** (migrations) from GitHub.

**When it runs**

- On **`push` to `main`** when files under `supabase/migrations/`, `supabase/seed.sql`, or the workflow file itself change.
- On **`workflow_dispatch`** (manual “Run workflow” in the Actions tab) so you can run it without a code change.

**What it does (summary)**

- Checks out the repo, installs dependencies, **links** the Supabase project, runs **`supabase db lint`**, then **`supabase db push`** against the **linked** remote project.

**Repository secrets (GitHub → Settings → Secrets and variables → Actions)**

Configure at least (names are illustrative — match what the workflow uses):

- `SUPABASE_ACCESS_TOKEN` — from Supabase account / CLI.
- `PROJECT_REF` — your Supabase project reference.
- `POSTGRES_PASSWORD` — database password (used when linking; align with your project’s requirements).
- `SUPABASE_URL` — if required by the workflow or CLI step.

**Important**

- **App** deployment (Next.js) is separate — usually **Vercel** on git push. **Migrations** are this workflow (or a manual `supabase db push` from a maintainer’s machine with the right access).
- Keep migration files **in version control**; the hosted DB should only receive changes you intend via `db push` or the Action, not ad-hoc edits in production only.

For day-to-day CLI usage (`supabase link`, `db push`, `db reset` locally), see `supabase/README.md` in the repository.

---

## Navigating Supabase (dashboard & database)

**Typical entry:** [https://app.supabase.com](https://app.supabase.com) → select your **organization** → **project** (WasteZero production/staging).

| Area | Purpose |
|------|--------|
| **Table Editor** | View/edit data (use carefully in production; respect RLS; dashboard often uses service role for admin tasks). |
| **SQL** → **SQL Editor** | **Ad-hoc queries** (`select`, reports), one-off DML, or DBA review. For **reproducible schema**, use **migrations** in the repo instead of only pasting SQL in production. |
| **Database** | Connection strings, extensions, **backups** (per plan), migration history awareness. |
| **Authentication** | List Auth users, reset actions; often you still want **`public.users`** and scripts like `create-users` to stay in sync. |
| **Settings** → **API** | **Project URL**, **anon** key, **service_role** key — the service role is **secret**; only server/CI, never the browser. |

**Migrations (how schema changes are supposed to work)**

1. Add a new file under `supabase/migrations/` in Git (timestamped name, e.g. `npx supabase migration new <description>`).
2. Test locally: `supabase db reset` or `supabase migration up` against local.
3. Merge to `main` and run **`db push`** (or let the **deploy-db** Action run if configured and you trust the path).

**Querying vs migrating**

- **Querying** (SELECT / exploratory SQL) — SQL Editor, read replicas if your plan supports them.
- **Schema changes (DDL)** — should live in **migration files** and go through **lint** + **push** so all environments match and history is auditable.

---

## Navigating Vercel (app hosting & GitHub)

**Typical entry:** [https://vercel.com](https://vercel.com) → your **team** → **WasteZero** (or the project name you created).

| Area | Purpose |
|------|--------|
| **Deployments** | **Every deployment** is tied to a **git commit** and branch. Production is usually the **`main`** branch; **preview** deployments often come from **Pull Requests** or other branches. |
| **Source** (Settings) | Which **GitHub org/repo/branch** Vercel watches; redeploy, disconnect, or reconnect. |
| **Settings** → **Environment variables** | Values for `Production`, `Preview`, and `Development`. Next.js and Supabase need URL + keys; **service role** only on the server, never in `NEXT_PUBLIC_*` unless you intend public exposure. |
| **Settings** → **Domains** | Production and preview hostnames, HTTPS. |
| **Settings** → **Git** | Confirm which branch is **production**; PR comments can show preview links. |

**How Vercel uses GitHub**

- **On push** to a connected branch, Vercel **builds** the Next.js app (`pnpm build` or the configured install/build commands) and **deploys** a new version.
- **No automatic Supabase migration** from Vercel — database updates are separate (see **CI/CD** above and Supabase).

**Preview vs production**

- **Preview** URLs are useful for QA; they need **valid env vars** (e.g. Supabase project for staging) if you do not use production data.
- If **Deployment Protection** is on (Vercel Authentication / password on previews), server-to-server clients (e.g. the **Windows log upload service**) need the [protection bypass](https://vercel.com/docs/security/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) for automation, **in addition to** the app’s ingest **API key**.

---

## Checklist (operators)

| Task | Where |
|------|--------|
| Add a new login | `public.users` + `pnpm create-users` |
| Change app code | GitHub PR → merge → Vercel deploys |
| Change **database schema** | `supabase/migrations/` in Git → `db push` or **deploy-db** Action |
| Run a report or inspect rows | Supabase **SQL Editor** (read carefully in prod) |
| Rotate web env secrets | Vercel **Environment variables** |
| Rotate or audit DB deploy to Supabase from CI | GitHub **Actions** secrets and **deploy-db** workflow logs |

For product-oriented steps (e.g. logging in, UI), use the [Quick start](./help.md) guide.
