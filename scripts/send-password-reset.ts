/**
 * Send a password-reset email to a user, admin-triggered.
 *
 * Generates the recovery link via the Supabase admin API and emails it
 * through lib/email.ts (Microsoft Graph) directly — bypasses Supabase
 * Auth's own SMTP mailer, which doesn't support Graph's OAuth2 flow.
 * Only sends if the email belongs to an active public.users row (same
 * check the self-service /api/auth/forgot-password route uses).
 *
 * Usage:
 *   pnpm reset-password --local <email>   # reads .env.local
 *   pnpm reset-password --linked <email>  # reads .env.prod.local
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { sendPasswordResetEmail } from "../lib/auth/password-reset";

const argv = process.argv.slice(2);
const useLocal = argv.includes("--local");
const useLinked = argv.includes("--linked");
const email = argv.find((a) => !a.startsWith("--"));

if (useLocal === useLinked || !email) {
  console.error("Error: exactly one of --local or --linked, plus an email, are required.");
  console.error("  pnpm reset-password --local <email>   # use .env.local");
  console.error("  pnpm reset-password --linked <email>  # use .env.prod.local");
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

const appUrl = process.env.APP_URL;
if (!appUrl) {
  console.error(`Error: APP_URL is required in ${envFile} (the app's origin, e.g. https://trak.example.com).`);
  process.exit(1);
}

async function main() {
  const result = await sendPasswordResetEmail(email!, appUrl!);

  if (!result.sent) {
    if (result.reason === "not_registered") {
      console.error(`Error: ${email} is not an active user in public.users. No email sent.`);
    } else {
      console.error("Error generating reset link (see Supabase admin API response for details).");
    }
    process.exit(1);
  }

  console.log(`Password reset email sent to ${email}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
