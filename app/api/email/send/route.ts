import { sendEmail } from "@/lib/email";
import { NextResponse } from "next/server";

const EMAIL_SEND_API_KEY = process.env.EMAIL_SEND_API_KEY;

/**
 * Vercel serverless function: send a single email (plain text).
 * Called internally by app flows that send email. Requires X-Email-Send-Key header.
 *
 * POST body: { to: string, subject: string, text: string }
 * Header: X-Email-Send-Key = EMAIL_SEND_API_KEY (set in Vercel env)
 *
 * Configure SMTP_* in the same project so this function can send.
 */
export async function POST(request: Request) {
  if (!EMAIL_SEND_API_KEY) {
    return NextResponse.json(
      { error: "Email send not configured (EMAIL_SEND_API_KEY)" },
      { status: 503 }
    );
  }

  const key = request.headers.get("X-Email-Send-Key");
  if (key !== EMAIL_SEND_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { to?: string; subject?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = typeof body?.to === "string" ? body.to.trim().toLowerCase() : null;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : null;
  const text = typeof body?.text === "string" ? body.text : null;

  if (!to || !subject || text === null) {
    return NextResponse.json(
      { error: "Missing or invalid to, subject, or text" },
      { status: 400 }
    );
  }

  try {
    await sendEmail(to, subject, text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/email/send]", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
