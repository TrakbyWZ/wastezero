import nodemailer from "nodemailer";

const FROM_EMAIL = process.env.OTP_FROM_EMAIL ?? "WasteZero <no-reply@wastezero.com>";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;

function hasSmtpConfig(): boolean {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);
}

function createTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
  });
}

/**
 * Sends a plain-text email. Used by the /api/email/send route.
 * If SMTP is not configured, logs to console (dev only).
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!hasSmtpConfig()) {
    console.log("\n--- Email (not sent; configure SMTP_* to send) ---");
    console.log("  To:", to);
    console.log("  Subject:", subject);
    console.log("  Body:", text.slice(0, 100) + (text.length > 100 ? "..." : "") + "\n");
    return;
  }

  const transporter = createTransporter();
  await transporter.sendMail({
    from: FROM_EMAIL,
    to,
    subject,
    text,
  });
}
