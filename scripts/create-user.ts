/**
 * Create Supabase Auth users from the public.users table.
 * Exactly one of --local or --linked is required.
 *
 * Usage:
 *   pnpm create-users --local   # reads .env.local
 *   pnpm create-users --linked  # reads .env.prod.local
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createAdminClient, createUser } from "../lib/supabase/admin";

const argv = process.argv.slice(2);
const useLocal = argv.includes("--local");
const useLinked = argv.includes("--linked");

if (useLocal === useLinked) {
  console.error("Error: Exactly one of --local or --linked is required.");
  console.error("  pnpm create-users --local   # use .env.local");
  console.error("  pnpm create-users --linked  # use .env.prod.local");
  process.exit(1);
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

const envFile = useLocal ? ".env.local" : ".env.prod.local";
loadEnvFile(envFile);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error(
    `Error: SUPABASE_URL and SUPABASE_SECRET_KEY required in ${envFile}.`
  );
  process.exit(1);
}
console.log(`Using ${envFile}:`, url);

const password = process.env.WZ_PASSWORD ?? "";

if (!password) {
  console.error(`Error: WZ_PASSWORD is required. Set it in ${envFile} or the environment.`);
  process.exit(1);
}

async function main() {
  const supabase = createAdminClient();
  const { data: rows, error: fetchError } = await supabase
    .from("users")
    .select("email, display_name");

  if (fetchError) {
    console.error("Error reading users table:", fetchError.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log("No users in public.users table.");
    return;
  }

  console.log(`Found ${rows.length} user(s) in public.users. Creating Auth users...`);

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const email = row.email as string;
    const displayName = row.display_name as string;
    try {
      await createUser(email, password, displayName);
      console.log("  Created:", email);
      created++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("already been registered") ||
        message.includes("already exists") ||
        message.includes("User already registered")
      ) {
        console.log("  Skipped (already in Auth):", email);
        skipped++;
      } else {
        console.error("  Error for", email, ":", message);
      }
    }
  }

  console.log(`Done. Created: ${created}, skipped: ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
