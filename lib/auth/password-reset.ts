import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { passwordResetEmailHtml } from "@/lib/email-templates";

export type SendPasswordResetResult =
  | { sent: true }
  | { sent: false; reason: "not_registered" | "generate_link_failed" };

/**
 * Generates a recovery link for `email` and emails it, but only if `email`
 * belongs to an active row in public.users — this app's allow-list, not just
 * any Supabase Auth user. Callers should return the same generic response
 * regardless of the result, to avoid leaking which emails are registered.
 */
export async function sendPasswordResetEmail(
  email: string,
  appUrl: string
): Promise<SendPasswordResetResult> {
  const admin = createAdminClient();

  const { data: userRow } = await admin
    .from("users")
    .select("is_active")
    .eq("email", email)
    .maybeSingle();

  if (!userRow?.is_active) {
    return { sent: false, reason: "not_registered" };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/auth/update-password` },
  });

  if (error || !data?.properties?.hashed_token) {
    return { sent: false, reason: "generate_link_failed" };
  }

  const resetUrl = `${appUrl}/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=/auth/update-password`;

  await sendEmail(
    email,
    "Reset your Trak password",
    `Reset your password: ${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    passwordResetEmailHtml({ resetUrl, appUrl })
  );

  return { sent: true };
}
