/**
 * Restore a SQL backup onto the local Supabase Postgres database.
 * Uses psql (PostgreSQL client tools must be on PATH).
 *
 * Usage:
 *   pnpm db:restore --file backups/wastezero-local-2026-05-31_21-16-51.sql
 *   pnpm db:restore --latest
 *   pnpm db:restore --file backups/foo.sql --reset-first --yes
 *
 * Options:
 *   --file <path>     Backup SQL file from pnpm db:backup (required unless --latest)
 *   --latest          Use the newest .sql file in backups/ (or --out dir)
 *   --out <dir>       Directory for --latest (default: backups/)
 *   --reset-first     Run `supabase db reset --no-seed` before restore (recommended)
 *   --yes             Skip confirmation prompt
 *   --dry-run         Print commands without executing
 *
 * Env: loads .env.local for optional DB_URL override.
 */

import { spawnSync } from "child_process";
import { createInterface } from "readline";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const argv = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
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

function usage(): never {
  console.error(`Usage: pnpm db:restore (--file <path> | --latest) [options]

Options:
  --out <dir>       Backup directory for --latest (default: backups/)
  --reset-first     Reset local DB to migrations (no seed) before restore
  --yes             Skip confirmation
  --dry-run         Print commands only`);
  process.exit(1);
}

function runCommand(label: string, args: string[], dryRun: boolean): void {
  console.log(`${label}: pnpm ${args.join(" ")}`);
  if (dryRun) return;

  const result = spawnSync("pnpm", args, {
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
}

function runPsql(dbUrl: string, filePath: string, dryRun: boolean): void {
  const args = [
    "psql",
    dbUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    filePath,
  ];
  console.log(`Restore: ${args.join(" ")}`);
  if (dryRun) return;

  const result = spawnSync("psql", args, {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(result.error.message);
    console.error("Ensure psql is installed and on your PATH.");
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function maskDbUrl(dbUrl: string): string {
  return dbUrl.replace(/:([^:@/]+)@/, ":****@");
}

function resolveLocalDbUrl(): string {
  const fromEnv = process.env.DB_URL?.trim();
  if (fromEnv) return fromEnv;

  const result = spawnSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
    encoding: "utf-8",
    cwd: process.cwd(),
    shell: process.platform === "win32",
  });

  if (result.status === 0 && result.stdout) {
    const match = result.stdout.match(/^DB_URL="([^"]+)"/m);
    if (match?.[1]) return match[1];
  }

  return "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
}

function resolveBackupFile(): string {
  const outDir = argValue("--out") ?? join(process.cwd(), "backups");

  if (hasFlag("--latest")) {
    if (!existsSync(outDir)) {
      console.error(`Error: backup directory not found: ${outDir}`);
      process.exit(1);
    }

    const sqlFiles = readdirSync(outDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => join(outDir, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

    if (sqlFiles.length === 0) {
      console.error(`Error: no .sql backups found in ${outDir}`);
      process.exit(1);
    }

    return sqlFiles[0]!;
  }

  const fileArg = argValue("--file");
  if (!fileArg) {
    console.error("Error: --file <path> or --latest is required.");
    usage();
  }

  const filePath = resolve(process.cwd(), fileArg);
  if (!existsSync(filePath)) {
    console.error(`Error: backup file not found: ${filePath}`);
    process.exit(1);
  }

  return filePath;
}

async function confirmRestore(filePath: string, dbUrl: string): Promise<boolean> {
  if (hasFlag("--yes")) return true;

  console.log("");
  console.log("This will restore a backup onto your LOCAL Supabase database.");
  console.log(`  Backup:   ${filePath}`);
  console.log(`  Database: ${maskDbUrl(dbUrl)}`);
  if (hasFlag("--reset-first")) {
    console.log("  Step 1:   supabase db reset --local --no-seed");
    console.log("  Step 2:   psql -f backup");
  } else {
    console.log("  Action:   psql -f backup (existing objects may conflict)");
  }
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    rl.question('Type "restore" to continue: ', (answer) => {
      rl.close();
      resolvePromise(answer.trim().toLowerCase() === "restore");
    });
  });
}

async function main() {
  loadEnvFile(".env.local");

  const dryRun = hasFlag("--dry-run");
  const filePath = resolveBackupFile();
  const dbUrl = resolveLocalDbUrl();

  const confirmed = await confirmRestore(filePath, dbUrl);
  if (!confirmed) {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log("");
  console.log(`Backup:     ${filePath}`);
  console.log(`Database:   ${maskDbUrl(dbUrl)}`);
  console.log("");

  if (hasFlag("--reset-first")) {
    runCommand(
      "Reset",
      ["exec", "supabase", "db", "reset", "--local", "--no-seed", "--yes"],
      dryRun,
    );
  }

  runPsql(dbUrl, filePath, dryRun);

  if (!dryRun) {
    console.log(`\nRestore complete: ${filePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
