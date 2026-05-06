# Supabase

## Migrations

Table DDL and schema changes live in `supabase/migrations/`. Files run in filename order (timestamped: `YYYYMMDDHHMMSS_description.sql`).

- **Local:** Run `npx supabase start` (or `supabase start`). Migrations are applied automatically when the local DB starts. To re-apply from scratch: `npx supabase db reset`.
- **Remote:** Link the project with `npx supabase link --project-ref <ref>`, then run `npx supabase db push` to apply pending migrations to the hosted database.

After changing migrations, create new timestamped files (e.g. `npx supabase migration new add_foo_column`) rather than editing already-applied migrations.

## API views (GET abstraction)

These views back the HTTP GET API routes so that underlying SQL can change without affecting API callers:

| View | GET route(s) |
|------|----------------|
| `vw_api_log_files_list` | `/api/log-files` (core `log_files` columns; no duplicate aggregates) |
| `vw_api_customers_list` | `/api/customers`, `/api/customers/[id]` |
| `vw_api_customer_sequence_for_customer` | `/api/customers/[id]/sequence` |
| `vw_api_customer_sequences_list` | `/api/customer-sequences`, `/api/customer-sequences/[id]` |
| `vw_api_batches_list` | `/api/batches` |

Filtering (e.g. `q`, `active_only`, `from`/`to`) and response shaping (nested `customer` / `customer_sequence`) remain in the API layer.

## Layout

- `config.toml` – Local Supabase config (ports, feature flags, etc.).
- `migrations/` – Versioned SQL migrations (source of truth for schema).
- `seed.sql` – Optional seed data, used when running `supabase db reset`.
