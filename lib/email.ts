const MS_TENANT_ID = process.env.MS_TENANT_ID;
const MS_CLIENT_ID = process.env.MS_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const MS_SENDER_EMAIL = process.env.MS_SENDER_EMAIL;

function hasGraphConfig(): boolean {
  return !!(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && MS_SENDER_EMAIL);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: MS_CLIENT_ID!,
        client_secret: MS_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to get Microsoft Graph access token: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/**
 * Sends an email via Microsoft Graph (app-only, client-credentials), as the
 * mailbox in MS_SENDER_EMAIL. Pass `html` for a rendered email (e.g. password
 * reset); `text` is always required as the plain-text body/dev-console fallback.
 * Used by the /api/email/send route and lib/auth/password-reset.ts. If MS_* is
 * not configured, logs to console (dev only).
 */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!hasGraphConfig()) {
    console.log("\n--- Email (not sent; configure MS_* to send via Microsoft Graph) ---");
    console.log("  To:", to);
    console.log("  Subject:", subject);
    console.log("  Body:", text.slice(0, 100) + (text.length > 100 ? "..." : "") + "\n");
    return;
  }

  const token = await getAccessToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MS_SENDER_EMAIL!)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: html
            ? { contentType: "HTML", content: html }
            : { contentType: "Text", content: text },
          toRecipients: [{ emailAddress: { address: to } }],
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Microsoft Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}
