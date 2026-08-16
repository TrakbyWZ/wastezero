/**
 * Restore a SQL backup onto the local Supabase Postgres database.
 *
 * Drops and recreates the local `postgres` database, then applies the full
 * backup file (schema + data). Uses psql on PATH when available; otherwise
 * runs psql inside the local Supabase Docker container.
 *
 * Usage:
 *   pnpm db:restore --local --file backups/wastezero-remote-2026-05-31_21-53-41.sql
 *   pnpm db:restore --local --latest --yes
 *
 * Target:
 *   --local           Required. Only the local Supabase Docker stack (never linked/remote).
 *
 * Options:
 *   --file <path>     Backup SQL file from pnpm db:backup (required unless --latest)
 *   --latest          Use the newest .sql file in backups/ (or --out dir)
 *   --out <dir>       Directory for --latest (default: backups/)
 *   --yes             Skip confirmation prompt
 *   --dry-run         Print commands without executing
 *
 * Env: local URL from `supabase status` (127.0.0.1:54322 only).
 */

import { spawnSync } from "child_process";
import { createInterface } from "readline";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const argv = process.argv.slice(2);
const useLocal = argv.includes("--local");
const LOCAL_DB_NAME = "postgres";
const PSQL_SUPERUSER = "supabase_admin";
const CONTAINER_RESTORE_PATH = "/tmp/wastezero-restore.sql";
/** Default local Supabase Docker password (POSTGRES_PASSWORD in config.toml); pg_hba requires it for supabase_admin over the container's local socket. */
const CONTAINER_DB_PASSWORD = "postgres";

function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
}

function hasFlag(name: string): boolean {
  return argv.includes(name);
}

function usage(): never {
  console.error(`Usage: pnpm db:restore --local (--file <path> | --latest) [options]

Target (required):
  --local           Local Supabase Docker only (127.0.0.1:54322). Never linked/remote.

Options:
  --out <dir>       Backup directory for --latest (default: backups/)
  --yes             Skip confirmation
  --dry-run         Print commands only

Backup sources use: pnpm db:backup --local | --linked | --db-url`);
  process.exit(1);
}

function parseRestoreTarget(): void {
  if (argv.includes("--linked") || argv.includes("--db-url")) {
    console.error("Error: db:restore only supports --local (Docker Supabase on this machine).");
    console.error("To pull data from hosted Supabase, run: pnpm db:backup --linked (or --db-url)");
    console.error("Then restore locally with:       pnpm db:restore --local --file backups/....sql");
    process.exit(1);
  }

  if (!useLocal) {
    console.error("Error: --local is required (restore never targets linked/remote databases).");
    usage();
  }
}

parseRestoreTarget();

function maskDbUrl(dbUrl: string): string {
  return dbUrl.replace(/:([^:@/]+)@/, ":****@");
}

function resolveLocalDbUrl(): string {
  const result = spawnSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
    encoding: "utf-8",
    cwd: process.cwd(),
  });

  if (result.status === 0 && result.stdout) {
    const match = result.stdout.match(/^DB_URL="([^"]+)"/m);
    if (match?.[1]) {
      assertLocalSupabaseHost(match[1]);
      return match[1];
    }
  }

  return "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
}

function assertLocalSupabaseHost(dbUrl: string): void {
  try {
    const host = new URL(dbUrl).hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
      console.error(
        `Error: local restore refused DB_URL host "${host}" (expected 127.0.0.1 or localhost).`,
      );
      console.error("Is local Supabase running? Try: pnpm exec supabase start");
      process.exit(1);
    }
  } catch {
    console.error("Error: could not parse local Supabase DB_URL.");
    process.exit(1);
  }
}

function adminDbUrl(dbUrl: string, database: string): string {
  try {
    const url = new URL(dbUrl);
    url.username = PSQL_SUPERUSER;
    url.pathname = `/${database}`;
    return url.toString();
  } catch {
    return dbUrl
      .replace(/\/\/([^:/@]+):/, `//${PSQL_SUPERUSER}:`)
      .replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
  }
}

function adminTemplate1DbUrl(dbUrl: string): string {
  return adminDbUrl(dbUrl, "template1");
}

function adminPostgresDbUrl(dbUrl: string): string {
  return adminDbUrl(dbUrl, LOCAL_DB_NAME);
}

function runPsqlCommand(
  dbUrl: string,
  sql: string,
  dryRun: boolean,
  label: string,
): void {
  console.log(`${label}: psql ${maskDbUrl(dbUrl)} -c "${sql.replace(/\s+/g, " ").trim()}"`);
  if (dryRun) return;

  const result = spawnSync(
    "psql",
    [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { stdio: "inherit" },
  );

  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status ?? 1);
  }
}

function runPsqlFile(dbUrl: string, filePath: string, dryRun: boolean, label: string): void {
  console.log(`${label}: psql ${maskDbUrl(dbUrl)} -f "${filePath}"`);
  if (dryRun) return;

  const result = spawnSync(
    "psql",
    [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", filePath],
    { stdio: "inherit" },
  );

  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status ?? 1);
  }
}

function isPsqlOnPath(): boolean {
  const result = spawnSync("psql", ["--version"], {
    encoding: "utf-8",
  });
  return result.status === 0;
}

function readSupabaseProjectId(): string | undefined {
  const configPath = join(process.cwd(), "supabase", "config.toml");
  if (!existsSync(configPath)) return undefined;
  const match = readFileSync(configPath, "utf-8").match(/^project_id\s*=\s*"([^"]+)"/m);
  return match?.[1];
}

function resolveSupabaseDbContainer(): string | undefined {
  const fromProjectId = readSupabaseProjectId();
  if (fromProjectId) {
    const named = `supabase_db_${fromProjectId}`;
    const check = spawnSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", named],
      { encoding: "utf-8" },
    );
    if (check.status === 0 && check.stdout.trim() === "true") {
      return named;
    }
  }

  const list = spawnSync(
    "docker",
    ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"],
    { encoding: "utf-8" },
  );
  if (list.status !== 0) return undefined;

  const names = list.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (fromProjectId) {
    const preferred = names.find((name) => name === `supabase_db_${fromProjectId}`);
    if (preferred) return preferred;
  }

  return names[0];
}

function runDockerShell(
  container: string,
  script: string,
  dryRun: boolean,
  label: string,
): void {
  console.log(`${label}: docker exec ${container} sh -c "<bootstrap script>"`);
  if (dryRun) return;

  const result = spawnSync("docker", ["exec", container, "sh", "-c", script], {
    stdio: "inherit",
  });

  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status ?? 1);
  }
}

const SUPABASE_PLATFORM_BOOTSTRAP_SCRIPT = `
set -e
export PGPASSWORD="\${PGPASSWORD:-postgres}"
export JWT_SECRET="\${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
export JWT_EXP="\${JWT_EXP:-3600}"
psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS extensions"
psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS vault"
psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role"
psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role"
for f in /docker-entrypoint-initdb.d/init-scripts/*.sql; do
  echo "Bootstrap init: $f"
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 -f "$f" || true
done
for f in /docker-entrypoint-initdb.d/migrations/*.sql; do
  echo "Bootstrap migration: $f"
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f "$f"
done
if [ -f /etc/postgresql.schema.sql ]; then
  echo "Bootstrap postinit: /etc/postgresql.schema.sql"
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 -f /etc/postgresql.schema.sql || true
fi
psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD 'postgres'"
`.trim();

function resetLocalPostgresPassword(container: string | undefined, dryRun: boolean): void {
  if (!container || dryRun) {
    console.log("Finalize: ensure postgres password is set for external clients (127.0.0.1:54322)");
    return;
  }

  runDockerPsqlCommand(
    container,
    LOCAL_DB_NAME,
    "ALTER USER postgres WITH PASSWORD 'postgres'",
    dryRun,
    "Finalize",
    PSQL_SUPERUSER,
  );
}

function bootstrapFreshSupabaseDatabase(container: string | undefined, dryRun: boolean): void {
  if (!container) {
    console.error(
      "Error: Supabase platform bootstrap requires the local Supabase DB Docker container.",
    );
    console.error("Start local Supabase with: pnpm exec supabase start");
    process.exit(1);
  }

  console.log(`Bootstrap: Supabase platform schemas via ${container}`);
  runDockerShell(container, SUPABASE_PLATFORM_BOOTSTRAP_SCRIPT, dryRun, "Bootstrap");
}

function runDockerPsqlCommand(
  container: string,
  database: string,
  sql: string,
  dryRun: boolean,
  label: string,
  user = "postgres",
): void {
  console.log(
    `${label}: docker exec ${container} psql -U ${user} -d ${database} -c "${sql.replace(/\s+/g, " ").trim()}"`,
  );
  if (dryRun) return;

  const result = spawnSync(
    "docker",
    [
      "exec",
      "-e",
      `PGPASSWORD=${CONTAINER_DB_PASSWORD}`,
      container,
      "psql",
      "-U",
      user,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { stdio: "inherit" },
  );

  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status ?? 1);
  }
}

function runDockerPsqlFile(
  container: string,
  hostFilePath: string,
  dryRun: boolean,
  label: string,
): void {
  console.log(`Restore: docker cp "${hostFilePath}" ${container}:${CONTAINER_RESTORE_PATH}`);
  console.log(
    `${label}: docker exec ${container} psql -U ${PSQL_SUPERUSER} -d ${LOCAL_DB_NAME} -f ${CONTAINER_RESTORE_PATH}`,
  );
  if (dryRun) return;

  const copy = spawnSync(
    "docker",
    ["cp", hostFilePath, `${container}:${CONTAINER_RESTORE_PATH}`],
    { stdio: "inherit" },
  );
  if (copy.error || copy.status !== 0) {
    if (copy.error) console.error(copy.error.message);
    process.exit(copy.status ?? 1);
  }

  const exec = spawnSync(
    "docker",
    [
      "exec",
      "-e",
      `PGPASSWORD=${CONTAINER_DB_PASSWORD}`,
      container,
      "psql",
      "-U",
      PSQL_SUPERUSER,
      "-d",
      LOCAL_DB_NAME,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      CONTAINER_RESTORE_PATH,
    ],
    { stdio: "inherit" },
  );

  spawnSync(
    "docker",
    ["exec", container, "rm", "-f", CONTAINER_RESTORE_PATH],
    { stdio: "ignore" },
  );

  if (exec.error || exec.status !== 0) {
    if (exec.error) console.error(exec.error.message);
    process.exit(exec.status ?? 1);
  }
}

const DROP_AND_RECREATE_STATEMENTS = [
  `DROP DATABASE IF EXISTS ${LOCAL_DB_NAME} WITH (FORCE)`,
  /** OWNER postgres: without it the db is owned by supabase_admin, so the postgres role isn't a pg_database_owner member and lacks CREATE on schema public (breaks `supabase migration up --local` for anything that creates/replaces objects, e.g. views). */
  `CREATE DATABASE ${LOCAL_DB_NAME} OWNER postgres`,
];

function runDropAndRecreateStatements(
  run: (sql: string, step: string) => void,
  dryRun: boolean,
): void {
  for (let i = 0; i < DROP_AND_RECREATE_STATEMENTS.length; i++) {
    const sql = DROP_AND_RECREATE_STATEMENTS[i]!;
    run(sql, `Drop/create ${i + 1}/${DROP_AND_RECREATE_STATEMENTS.length}`);
    if (dryRun) continue;
  }
}

function dropAndRecreateLocalDatabase(dbUrl: string, dryRun: boolean): void {
  console.log("Recreate: drop and create local postgres database (as supabase_admin)");

  if (isPsqlOnPath()) {
    const adminUrl = adminTemplate1DbUrl(dbUrl);
    runDropAndRecreateStatements(
      (sql, step) => runPsqlCommand(adminUrl, sql, dryRun, step),
      dryRun,
    );
    return;
  }

  const container = resolveSupabaseDbContainer();
  if (!container) {
    console.error(
      "Error: psql is not on PATH and no running Supabase DB container was found.",
    );
    console.error("Install PostgreSQL client tools or start local Supabase (supabase start).");
    process.exit(1);
  }

  console.log(`Recreate via Docker container: ${container}`);
  runDropAndRecreateStatements(
    (sql, step) =>
      runDockerPsqlCommand(container, "template1", sql, dryRun, step, PSQL_SUPERUSER),
    dryRun,
  );
}

const DATA_DUMP_MARKER = "-- Data dump (appended by pnpm db:backup)";

function splitBackupContent(content: string): { schemaPart: string; dataPart: string | null } {
  const markerIndex = content.indexOf(DATA_DUMP_MARKER);
  if (markerIndex === -1) {
    return { schemaPart: content, dataPart: null };
  }

  return {
    schemaPart: content.slice(0, markerIndex).trimEnd(),
    dataPart: content.slice(markerIndex + DATA_DUMP_MARKER.length).trimStart(),
  };
}

function extractPublicSchemaDataDump(dataPart: string): string {
  const lines = dataPart.split(/\r?\n/);
  const result: string[] = [];
  let mode: "preamble" | "public_copy" | "skip_copy" = "preamble";

  for (const line of lines) {
    const copyMatch = line.match(/^COPY "([^"]+)"/);
    if (copyMatch) {
      if (copyMatch[1] === "public") {
        mode = "public_copy";
        result.push(line);
      } else {
        mode = "skip_copy";
      }
      continue;
    }

    if (line === "\\.") {
      if (mode === "public_copy") result.push(line);
      mode = "preamble";
      continue;
    }

    if (mode === "skip_copy") continue;
    if (mode === "public_copy") {
      result.push(line);
      continue;
    }

    if (line.startsWith("SELECT pg_catalog.setval(")) continue;
    result.push(line);
  }

  return `${result.join("\n").trimEnd()}\n`;
}

function writeTempSql(content: string, label: string): string {
  const filePath = join(tmpdir(), `wastezero-restore-${label}-${process.pid}.sql`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function cleanupTempFiles(...paths: string[]): void {
  for (const filePath of paths) {
    try {
      unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

function applyBackup(
  dbUrl: string,
  filePath: string,
  dryRun: boolean,
  container?: string,
): void {
  const backupContent = readFileSync(filePath, "utf-8");
  const { schemaPart, dataPart } = splitBackupContent(backupContent);
  const tempFiles: string[] = [];

  try {
    const schemaFile = writeTempSql(schemaPart, "schema");
    tempFiles.push(schemaFile);

    if (dataPart) {
      console.log("Restore data: public schema only (auth/storage skipped for local compatibility)");
      const dataFile = writeTempSql(extractPublicSchemaDataDump(dataPart), "data");
      tempFiles.push(dataFile);
      runBackupSql(dbUrl, schemaFile, dryRun, container, "Restore schema");
      runBackupSql(dbUrl, dataFile, dryRun, container, "Restore data");
      return;
    }

    runBackupSql(dbUrl, schemaFile, dryRun, container, "Restore");
  } finally {
    if (!dryRun) cleanupTempFiles(...tempFiles);
  }
}

function runBackupSql(
  dbUrl: string,
  sqlFilePath: string,
  dryRun: boolean,
  container: string | undefined,
  label: string,
): void {
  if (isPsqlOnPath()) {
    runPsqlFile(adminPostgresDbUrl(dbUrl), sqlFilePath, dryRun, label);
    return;
  }

  if (!container) {
    container = resolveSupabaseDbContainer();
  }
  if (!container) {
    console.error(
      "Error: psql is not on PATH and no running Supabase DB container was found.",
    );
    process.exit(1);
  }

  if (label === "Restore schema" || label === "Restore") {
    console.log(`Restore via Docker container: ${container}`);
  }
  runDockerPsqlFile(container, sqlFilePath, dryRun, label);
}

function resolveBackupFile(): string {
  const outDir = argValue("--out") ?? join(process.cwd(), "backups");

  if (hasFlag("--latest")) {
    if (!existsSync(outDir)) {
      console.error(`Error: backup directory not found: ${outDir}`);
      process.exit(1);
    }

    const sqlFiles = readdirSync(outDir)
      .filter((name) => name.endsWith(".sql") && !name.endsWith(".restore-data.tmp"))
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
  console.log("This will REPLACE your LOCAL Supabase database with the backup.");
  console.log("  Target:   local Supabase Docker (never linked/remote)");
  console.log(`  Backup:   ${filePath}`);
  console.log(`  Database: ${maskDbUrl(dbUrl)}`);
  console.log("  Step 1:   DROP DATABASE postgres + CREATE DATABASE postgres (supabase_admin)");
  console.log("  Step 2:   Bootstrap Supabase platform schemas (auth, storage, extensions, …)");
  console.log("  Step 3:   psql -f backup as supabase_admin (schema + data)");
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
  if (hasFlag("--reset-first")) {
    console.warn("Note: --reset-first is no longer used; restore always drops and recreates the database.");
  }

  const dryRun = hasFlag("--dry-run");
  const filePath = resolveBackupFile();
  const dbUrl = resolveLocalDbUrl();

  const confirmed = await confirmRestore(filePath, dbUrl);
  if (!confirmed) {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log("");
  console.log(`Target:     local Supabase Docker`);
  console.log(`Backup:     ${filePath}`);
  console.log(`Database:   ${maskDbUrl(dbUrl)}`);
  console.log("");

  dropAndRecreateLocalDatabase(dbUrl, dryRun);
  const container = resolveSupabaseDbContainer();
  bootstrapFreshSupabaseDatabase(container, dryRun);
  applyBackup(dbUrl, filePath, dryRun, container);
  resetLocalPostgresPassword(container, dryRun);

  if (!dryRun) {
    console.log(`\nRestore complete: ${filePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
