/**
 * Apply pending local migrations to the LOCAL Supabase database.
 *
 * `pnpm db:restore --local` loads a raw pg_dump onto the local DB without going
 * through Supabase's migration tooling, so the local `supabase_migrations.schema_migrations`
 * history table doesn't reflect it. Run this afterward to bring local up to date with
 * whatever migrations exist only in this working tree (e.g. ones not yet pushed to prod).
 *
 * How it works:
 *   1. `supabase migration list` diffs local migration files against the linked (remote)
 *      project's applied history. Versions already applied on remote are assumed to already
 *      be reflected in the restored dump.
 *   2. `supabase migration repair --local --status applied <those versions>` seeds the local
 *      history table with them, without re-running their SQL (idempotent; safe to re-run).
 *   3. `supabase migration up --local` applies whatever's left — the local-only migrations.
 *
 * Usage:
 *   pnpm db:migrate:local            Apply pending local-only migrations to the local DB
 *   pnpm db:migrate:local --dry-run  Show the plan without running repair/up
 *
 * Requires: `supabase link` (to diff against remote history) and local Supabase running.
 */

import { spawnSync } from "child_process";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

function usage(): never {
  console.error(`Usage: pnpm db:migrate:local [--dry-run]

Applies migrations that exist only in this working tree (not yet applied on the
linked remote project) to the local Supabase database.

Options:
  --dry-run   Show which migrations would be repaired/applied without running them`);
  process.exit(1);
}

if (argv.some((a) => a !== "--dry-run")) {
  usage();
}

function run(args: string[], captureOutput: boolean): { status: number; stdout: string } {
  const result = spawnSync("pnpm", ["exec", "supabase", ...args], {
    cwd: process.cwd(),
    shell: process.platform === "win32",
    encoding: "utf-8",
    stdio: captureOutput ? ["inherit", "pipe", "inherit"] : "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  const stdout = captureOutput ? result.stdout ?? "" : "";
  if (captureOutput) process.stdout.write(stdout);

  return { status: result.status ?? 1, stdout };
}

interface MigrationRow {
  local: string;
  remote: string | null;
}

function parseMigrationList(output: string): MigrationRow[] {
  const rows: MigrationRow[] = [];
  const rowPattern = /^\s*(\d{14})\s*\|\s*(\d{14})?\s*\|/;

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(rowPattern);
    if (!match) continue;
    rows.push({ local: match[1]!, remote: match[2] ?? null });
  }

  return rows;
}

function main() {
  console.log("Diffing local migration files against the linked project's history...\n");
  const listResult = run(["migration", "list"], true);
  if (listResult.status !== 0) {
    console.error("\nError: `supabase migration list` failed. Is the project linked (`supabase link`)?");
    process.exit(listResult.status);
  }

  const rows = parseMigrationList(listResult.stdout);
  if (rows.length === 0) {
    console.error("\nError: could not parse any migration versions from `supabase migration list` output.");
    process.exit(1);
  }

  const alreadyOnRemote = rows.filter((r) => r.remote).map((r) => r.local);
  const localOnly = rows.filter((r) => !r.remote).map((r) => r.local);

  console.log(`\nAlready applied on remote (assumed present in the restored dump): ${alreadyOnRemote.length}`);
  console.log(`Local-only, pending apply to local DB: ${localOnly.length}${localOnly.length ? " -> " + localOnly.join(", ") : ""}`);

  if (localOnly.length === 0) {
    console.log("\nNothing to do: local has no migrations beyond what's already on remote.");
    return;
  }

  if (dryRun) {
    console.log("\nDry run: would repair the local history table for the already-applied versions, then run `supabase migration up --local`.");
    return;
  }

  if (alreadyOnRemote.length > 0) {
    console.log("\nSeeding local migration history (marking already-applied versions, without re-running them)...");
    const repairResult = run(["migration", "repair", "--local", "--status", "applied", ...alreadyOnRemote], false);
    if (repairResult.status !== 0) process.exit(repairResult.status);
  }

  console.log("\nApplying pending local-only migrations to the local database...");
  const upResult = run(["migration", "up", "--local"], false);
  if (upResult.status !== 0) process.exit(upResult.status);
}

main();
