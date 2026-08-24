# Disaster recovery: backing up and restoring production data

This page is for **IT and DBAs** who need to (1) keep a local, independent copy of the production database in case data is lost or corrupted, and (2) know exactly how to put a backup back into the **same** hosted Supabase project. It does not cover losing the Supabase project itself (a new project, re-applying migrations, and re-provisioning Auth users is a different, larger procedure).

For the underlying scripts, see `scripts/backup-db.ts` and `scripts/restore-db.ts` in the repository. For schema/migrations background, see [App structure, Supabase connection, and database construction](./app-structure-and-database.md).

---

## What this covers

- **Scenario:** the hosted Supabase project still exists, but its data is in a bad state — a bad migration corrupted rows, someone deleted data by mistake, or you simply want to reset production to a known-good point.
- **Goal:** reload the `public` schema tables (the app's own tables — `customer`, `batch`, `log_files`, `log_entries`, etc.) from a backup file, without touching Supabase's own `auth`/`storage` schemas. That means logins and sessions are unaffected by a restore.
- **Not covered here:** recovering when the Supabase *project itself* is gone. That requires a new project, `supabase db push` to re-apply all migrations, re-running `pnpm create-users`, and then the data-restore steps below.

There is deliberately **no single command** that restores production. Every step below is manual so a restore is always a reviewed, deliberate action — not something a mistyped flag or muscle memory (from the local-only `pnpm db:restore`) can trigger against live data.

---

## Taking a backup

```bash
pnpm db:backup --linked
```

This uses the linked Supabase project (via `supabase link`) and writes a timestamped file to the local, gitignored `backups/` folder, e.g. `backups/wastezero-linked-2026-08-19_10-00-00.sql`.

**Important:** use the **default** mode (schema + data), not `--data-only`. `pnpm db:backup --linked --data-only` dumps *every* schema, including Supabase's internal `auth`/`storage` data — not what you want for this procedure. The default mode's appended data section is already scoped to `--schema public` only (see `backup-db.ts`), which is exactly what the restore steps below expect.

**Current limitation:** these backups only exist on whatever machine ran the command — `backups/` is gitignored and nothing today copies them off that machine. Take one whenever you want a safety point (e.g. before a risky migration or bulk data change), and keep at least one recent copy somewhere you trust. If you later want a true offsite/cloud copy, that's a separate follow-up (see the "Backups & compliance" note in [System overview](./architecture.md)).

---

## Restoring data into the live hosted project

Do this only when you have a specific reason (bad migration, bad delete, known-good rollback target) and a backup file you trust.

### 1. Take one more fresh backup first

Even if production is in a bad state, back it up again right before you touch anything — you may need to compare against or recover something from the exact pre-restore state:

```bash
pnpm db:backup --linked
```

### 2. Get the production connection string

From the Supabase dashboard: **Settings → Database → Connection string** (direct connection, not the pooler, for `psql`). Or, if `.env.prod.local` has a working `DB_URL`, use that. Do not proceed until you've confirmed this is the correct project — check the project ref in the URL against `supabase/config.toml`'s `project_id` or your `PROJECT_REF` secret.

```bash
export DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
```

### 3. List the current public tables

```bash
psql "$DB_URL" -c "select tablename from pg_tables where schemaname = 'public' order by tablename;"
```

Keep this list — you'll need every table name in the `TRUNCATE` statement in step 5. Table names change over time as migrations are added; always use this live query, not a list copied from documentation.

### 4. Extract the data section from the backup file

Open the backup file (the one you're restoring *from*, not the safety-net one from step 1) and find the marker line:

```
-- Data dump (appended by pnpm db:backup)
```

Copy everything **after** that line into a new file, e.g. `restore-data.sql`. That section is pure `COPY ... FROM stdin` statements for `public` schema tables only, already in FK-dependency order (produced by `pg_dump`) — nothing above the marker (the schema/DDL section) should be applied here, since schema is owned by migrations, not by this restore.

If a bad migration also broke the schema itself, fix that first — e.g. revert or forward-fix via a new migration and `supabase db push --linked` — before reloading data. Don't use this procedure to restore schema.

### 5. Truncate and reload, in one transaction

```bash
psql "$DB_URL"
```

Inside the `psql` session:

```sql
BEGIN;

-- Paste the exact table list from step 3:
TRUNCATE public.customer, public.customer_sequence, public.batch,
  public.log_files, public.log_entries, public.users
  RESTART IDENTITY CASCADE;

\i restore-data.sql

-- Spot-check before committing:
SELECT count(*) FROM public.customer;
SELECT count(*) FROM public.log_entries;
```

Only run `COMMIT;` once the row counts look right. If anything looks wrong, run `ROLLBACK;` instead — nothing is applied until you commit.

```sql
COMMIT;
```

Truncating every public table together in a single statement lets `RESTART IDENTITY CASCADE` handle foreign-key ordering for you, so you don't need to sequence individual `TRUNCATE`s by hand.

### 6. Verify

- Spot-check a few known rows/customers in the app itself.
- Confirm logins still work (Auth data was never touched).
- Note the incident and which backup file you restored from.

---

## Why this is manual, not scripted

`pnpm db:restore` (in `scripts/restore-db.ts`) intentionally refuses any target other than `--local` — it drops and recreates the entire database, including Supabase's own `auth`/`storage` schemas, which is safe for a local Docker instance but would destroy a live hosted project. Building an equivalent one-command restore for production was considered and rejected: a callable command that can overwrite production data is a bigger risk (wrong project, stale file, habit) than the extra few minutes a manual runbook takes. Keep it manual.
