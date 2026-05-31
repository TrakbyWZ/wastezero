/**
 * Backup the Supabase Postgres database to a timestamped SQL file.
 * Uses `supabase db dump` (requires Supabase CLI and pg_dump on PATH).
 *
 * Exactly one target is required:
 *   pnpm db:backup --local
 *   pnpm db:backup --linked
 *   pnpm db:backup --db-url "postgresql://user:pass@host:5432/postgres"
 *   pnpm db:backup --db-url                    # DB_URL from env file
 *
 * Options:
 *   --env local|prod   Env file for --db-url without inline URL (default: prod)
 *   --out <dir>        Output directory (default: backups/)
 *   --data-only        Dump data rows only (no schema DDL)
 *   --dry-run          Print pg_dump command without running
 *
 * Restore: pnpm db:restore --file <this-backup.sql> [--reset-first] --yes
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const argv = process.argv.slice(2);
const useLocal = argv.includes("--local");
const useLinked = argv.includes("--linked");
const useDbUrl = argv.includes("--db-url");

function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  const value = argv[i + 1];
  if (value.startsWith("-")) return undefined;
  return value;
}

function hasFlag(name: string): boolean {
  return argv.includes(name);
}

function loadEnvFile(filename: string) {
  const envPath = join(process.cwd(), filename);
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    process.env[key] = value;
  }
}

function resolveEnvFile(): string {
  const profile = argValue("--env")?.toLowerCase();
  if (profile === "local") return ".env.local";
  if (profile === "prod") return ".env.prod.local";
  if (useLocal) return ".env.local";
  if (useLinked) return ".env.prod.local";
  return ".env.prod.local";
}

function usage(): never {
  console.error(`Usage: pnpm db:backup (--local | --linked | --db-url [connection-string]) [options]

Targets:
  --local                         Local Supabase (supabase start must be running)
  --linked                        Linked remote project (supabase link)
  --db-url [postgresql://...]     Direct Postgres URL, or DB_URL from env if omitted

Options:
  --env local|prod                Env file for --db-url without inline URL (default: prod)
  --out <dir>                     Output directory (default: backups/)
  --data-only                     Dump data only
  --dry-run                       Show pg_dump command without executing`);
  process.exit(1);
}

const targetCount = [useLocal, useLinked, useDbUrl].filter(Boolean).length;
if (targetCount !== 1) {
  console.error("Error: Exactly one of --local, --linked, or --db-url is required.");
  usage();
}

const envFile = resolveEnvFile();
if (useLinked || useDbUrl) {
  loadEnvFile(envFile);
}
if (useLocal) {
  loadEnvFile(".env.local");
}

function maskDbUrl(dbUrl: string): string {
  return dbUrl.replace(/:([^:@/]+)@/, ":****@");
}

function resolveDbUrl(): string {
  const inline = argValue("--db-url")?.trim();
  if (inline) {
    if (!/^postgres(ql)?:\/\//i.test(inline)) {
      console.error("Error: --db-url value must be a postgresql:// or postgres:// connection string.");
      process.exit(1);
    }
    return inline;
  }

  const fromEnv = process.env.DB_URL?.trim();
  if (!fromEnv) {
    console.error(`Error: pass --db-url "postgresql://..." or set DB_URL in ${envFile}.`);
    console.error("Use the direct Postgres connection string from the Supabase dashboard.");
    process.exit(1);
  }
  return fromEnv;
}

function backupTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

function main() {
  const outDir = argValue("--out") ?? join(process.cwd(), "backups");
  mkdirSync(outDir, { recursive: true });

  const targetLabel = useLocal ? "local" : useLinked ? "linked" : "remote";
  const filePath = join(outDir, `wastezero-${targetLabel}-${backupTimestamp()}.sql`);

  const dumpArgs = ["exec", "supabase", "db", "dump", "-f", filePath];

  let connectionLabel: string | undefined;
  if (useLocal) {
    dumpArgs.push("--local");
  } else if (useLinked) {
    dumpArgs.push("--linked");
  } else {
    const dbUrl = resolveDbUrl();
    connectionLabel = maskDbUrl(dbUrl);
    dumpArgs.push("--db-url", dbUrl);
  }

  if (hasFlag("--data-only")) {
    dumpArgs.push("--data-only");
  }
  if (hasFlag("--dry-run")) {
    dumpArgs.push("--dry-run");
  }

  console.log(`Target:     ${targetLabel}`);
  if (connectionLabel) {
    console.log(`Database:   ${connectionLabel}`);
  }
  if (useDbUrl && !argValue("--db-url")) {
    console.log(`Env file:   ${envFile} (DB_URL)`);
  } else if (useLinked) {
    console.log(`Env file:   ${envFile}`);
  }
  console.log(`Output:     ${filePath}`);
  console.log(`Command:    pnpm ${dumpArgs.map((a) => (a.includes("postgres") ? maskDbUrl(a) : a)).join(" ")}`);
  console.log("");

  const result = spawnSync("pnpm", dumpArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!hasFlag("--dry-run") && existsSync(filePath)) {
    console.log(`\nBackup saved: ${filePath}`);
  }
}

main();
