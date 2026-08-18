"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updatePasswordSchema } from "@/lib/auth/schemas";
import {
  signSession,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/session";

export type UpdatePasswordResult = { error?: string; success?: true };

export async function updatePasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<UpdatePasswordResult> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const msg =
      flat.password?.[0] ?? flat.confirmPassword?.[0] ?? "Invalid password.";
    return { error: msg };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: updateError,
  } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (updateError) {
    return { error: updateError.message };
  }

  const email = user?.email;
  if (!email) {
    return {
      error: "Your reset link is no longer valid. Ask for a new one and try again.",
    };
  }

  const admin = createAdminClient();
  const { data: appUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  await admin
    .from("users")
    .update({ needs_password_reset: false })
    .eq("email", email);

  const token = signSession({ email, userId: appUser?.id });
  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), token, getSessionCookieOptions());

  return { success: true };
}
