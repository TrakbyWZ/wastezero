"use server";

import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/auth/schemas";

export type LoginResult = { error?: string; success?: true };

export async function loginAction(
  _prev: unknown,
  formData: FormData,
): Promise<LoginResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });

  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg =
      first.email?.[0] ?? first.password?.[0] ?? "Invalid email or password.";
    return { error: msg };
  }

  const { email, password } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Return success so the client can navigate after cookies are in the response.
  // Server-side redirect() can send the redirect before Set-Cookie is committed,
  // so the next request has no session and the user appears to go nowhere.
  return { success: true };
}
