import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client with service role. Use only in API routes or
 * server code for auth and other privileged operations. Never expose to client.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY"
    );
  }
  return createClient(url, key);
}


/**
 * Create a user in Supabase Auth (server/admin only).
 * Requires service role key. Use from API routes or scripts like scripts/create-user.ts.
 */
export async function createUser(
  email: string,
  password: string,
  name: string
) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    user_metadata: { name },
    email_confirm: true,
  });
  if (error) throw error;
  return data;
}