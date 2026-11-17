/**
 * Guard shared by the destructive correlation test scripts
 * (scripts/test-log-correlation.ts, scripts/test-log-correlation-gaps.ts).
 *
 * Those scripts are not read-only: they seed a customer, a customer_sequence,
 * log_files, log_entries and log_correlations, and they delete anything left
 * over from a previous run before they start. That is fine against a throwaway
 * local database and unacceptable against a hosted one.
 *
 * The concrete hazard is not the writes themselves but customer resolution:
 * run_log_correlation() matches each code against *every* customer_sequence by
 * regex (customer_sequence_cam1_data_value_regex), so a sequence seeded by a
 * test participates in resolving real rows for as long as it exists. The test
 * prefix used to be R005C, which belongs to customer EVERGREEN in production -
 * had the suite ever been pointed at the hosted project, real EVERGREEN
 * correlations could have resolved to the test customer. The prefix is now
 * ZQTST and each script re-checks it is unused at startup, but neither of
 * those stops someone running the suite against production and creating the
 * collision there in the first place. This does.
 *
 * Mirrors the deliberate --local-only guard in scripts/restore-db.ts: refuse
 * the flag, then verify the host the env actually resolved to, since a
 * .env.local pointing at a hosted project would otherwise sail past a flag
 * check alone. There is no override flag, by design.
 */

/** Hosts that can only be a Supabase stack running on this machine. */
const LOCAL_SUPABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Reject --linked/--db-url and require --local. Call before loading env.
 *
 * @param scriptName - npm script name, used in the usage message.
 */
export function requireLocalFlag(scriptName: string): void {
  const argv = process.argv.slice(2);

  if (argv.includes("--linked") || argv.includes("--db-url")) {
    console.error(
      `Error: ${scriptName} only supports --local (Docker Supabase on this machine).`,
    );
    console.error(
      "This suite seeds and deletes rows, and the customer_sequence it creates",
    );
    console.error(
      "takes part in resolving real codes for as long as it exists. It must",
    );
    console.error("never run against a linked or hosted project.");
    console.error("");
    console.error("To test against production data, copy it down first:");
    console.error("  pnpm db:refresh:local   # backup --linked, restore --local");
    console.error("  pnpm db:migrate:local");
    console.error(`  pnpm ${scriptName} -- --local`);
    process.exit(1);
  }

  if (!argv.includes("--local")) {
    console.error(
      `Error: --local is required (${scriptName} never targets linked/remote databases).`,
    );
    console.error(`Usage: pnpm ${scriptName} -- --local`);
    process.exit(1);
  }
}

/**
 * Verify the resolved SUPABASE_URL is a local stack. Call after loading env
 * and before creating the admin client - a .env.local pointing at a hosted
 * project passes requireLocalFlag() but must still be refused here.
 *
 * @param scriptName - npm script name, used in the error message.
 */
export function assertLocalSupabaseUrl(scriptName: string): void {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    console.error("Missing SUPABASE_URL in env.");
    process.exit(1);
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    console.error(`Error: could not parse SUPABASE_URL ("${url}").`);
    process.exit(1);
  }

  if (!LOCAL_SUPABASE_HOSTS.has(host)) {
    console.error(
      `Error: ${scriptName} refused SUPABASE_URL host "${host}" (expected a local stack: ${[...LOCAL_SUPABASE_HOSTS].join(", ")}).`,
    );
    console.error(
      "--local was passed, but .env.local points at a non-local project. This",
    );
    console.error(
      "suite writes and deletes rows, so it will not run against that host.",
    );
    console.error("");
    console.error("Point .env.local at the local stack: pnpm exec supabase status -o env");
    process.exit(1);
  }
}
