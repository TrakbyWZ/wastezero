import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const GENERIC_MESSAGE = "If that email is registered, you'll receive a password reset link shortly.";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors.email?.[0] ?? "Please enter a valid email address" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    console.error("[api/auth/forgot-password] Missing APP_URL");
  } else {
    try {
      await sendPasswordResetEmail(email, appUrl);
    } catch (err) {
      console.error("[api/auth/forgot-password]", err);
    }
  }

  // Same response whether or not the account exists, so this endpoint can't
  // be used to enumerate registered emails.
  return NextResponse.json({ message: GENERIC_MESSAGE });
}
