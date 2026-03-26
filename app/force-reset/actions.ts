"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { forceResetSchema } from "@/lib/auth/schemas";

export type ForceResetResult = { error?: string; success?: true };

export async function forceResetAction(
  _prev: unknown,
  formData: FormData,
): Promise<ForceResetResult> {
  const parsed = forceResetSchema.safeParse({
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
  if (email) {
    const admin = createAdminClient();
    await admin
      .from("users")
      .update({ needs_password_reset: false })
      .eq("email", email);
  }

  return { success: true };
}
