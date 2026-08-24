# Sending real email with Google or Outlook SMTP

This app has **two independent mailers** — a client wanting to "use their Google/Outlook email" usually needs to configure **both**, or they'll wonder why one flow sends email and another doesn't.

| Mailer | Sends | Configured in |
| ------ | ----- | ------------- |
| **Supabase Auth SMTP** | Password-reset links (`resetPasswordForEmail` in [`forgot-password-form.tsx`](../../components/forgot-password-form.tsx)), and any other built-in Supabase Auth email (invites, email-change confirmation) | Supabase **Dashboard** (hosted) or `[auth.email.smtp]` in `supabase/config.toml` (local) |
| **App mailer** (`lib/email.ts`, nodemailer) | Plain-text email sent via `/api/email/send`, called internally by app flows | `SMTP_*` env vars in `.env.local` / Vercel project env vars |

Without SMTP configured: Supabase Auth emails silently fail/queue per its own rules, and the app mailer logs to console instead of sending (see `lib/email.ts`).

---

## 1. Get SMTP credentials from the client's provider

Both providers require an **app password** (not the user's normal login password) because they don't allow plain SMTP auth with 2FA-protected accounts.

### Google (Gmail / Google Workspace)

1. Enable 2-Step Verification on the sending account (required for app passwords): `myaccount.google.com/security`.
2. Create an app password: `myaccount.google.com/apppasswords` → app "Mail" → generate → copy the 16-character password.
3. SMTP settings:
   - Host: `smtp.gmail.com`
   - Port: `587` (STARTTLS) — or `465` (implicit TLS)
   - Username: the full Gmail/Workspace address
   - Password: the app password from step 2
4. Limits: personal Gmail caps at ~500 messages/day; Google Workspace is higher but still not meant for high-volume transactional mail. Fine for auth emails on a small client deployment.

### Microsoft (Outlook.com / Microsoft 365)

1. If the account has MFA enabled (recommended), create an app password: `account.live.com/proofs/AppPassword` (Outlook.com) or via the Microsoft 365 admin center for a work/school account.
2. For **Microsoft 365 org accounts**, an admin may also need to enable **SMTP AUTH** for the mailbox (Exchange Admin Center → mailbox → "Manage email apps" → Authenticated SMTP), since Microsoft disables it by default.
3. SMTP settings:
   - Host: `smtp.office365.com`
   - Port: `587` (STARTTLS)
   - Username: the full Outlook/Microsoft 365 address
   - Password: the app password (or account password if SMTP AUTH + basic auth is explicitly enabled — increasingly rare as Microsoft phases out basic auth)
4. Limits: Microsoft 365 mailboxes are typically capped around 10,000 recipients/day; Outlook.com personal accounts are much lower.

Neither provider is a substitute for a transactional email service (Resend, SES, Postmark, etc.) at real volume — but both work fine for a low-volume client deployment, which is the common case here.

---

## 2. Configure Supabase Auth SMTP (password-reset emails)

Reference: [Supabase custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

**Hosted project:**

1. Supabase Dashboard → your project → **Authentication** → **Emails** → **SMTP Settings**.
2. Toggle **Enable Custom SMTP** and fill in:
   - Sender email — the Gmail/Outlook address
   - Sender name — e.g. `WasteZero`
   - Host / port / username / password — from step 1 above
3. Save. Supabase applies a default rate limit (30 emails/hour) — raise it under **Authentication** → **Rate Limits** if the client needs more.

**Local dev** (`supabase/config.toml`, only if you want real emails locally instead of Inbucket/Mailpit):

```toml
[auth.email.smtp]
enabled = true
host = "smtp.gmail.com"        # or smtp.office365.com
port = 587
user = "env(SMTP_AUTH_USER)"
pass = "env(SMTP_AUTH_PASS)"
sender_name = "WasteZero"
```

Set `SMTP_AUTH_USER` / `SMTP_AUTH_PASS` in your shell or `.env` before `supabase start`, then `pnpm exec supabase stop && pnpm exec supabase start` to pick up the config change. Leave this disabled for most local dev — the default Inbucket/Mailpit capture (see `local-development.md`) is faster to iterate with.

---

## 3. Configure the app's own mailer (`/api/email/send`)

This is separate from Supabase Auth and uses `lib/email.ts` directly. Set in `.env.local` (local) or Vercel **Settings → Environment Variables** (hosted):

| Variable | Value |
| -------- | ----- |
| `SMTP_HOST` | `smtp.gmail.com` or `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` (STARTTLS on 587; set `true` only if using port 465) |
| `SMTP_USER` | full email address |
| `SMTP_PASSWORD` | the app password from step 1 |
| `OTP_FROM_EMAIL` | e.g. `WasteZero <no-reply@clientdomain.com>` |
| `EMAIL_SEND_API_KEY` | any strong random value — required by `/api/email/send` as the `X-Email-Send-Key` header |

Using the **same** Gmail/Outlook account for both mailers is fine — just repeat the credentials from step 1 in both places.

---

## 4. Test

- **Password reset:** trigger "Forgot password" in the app; confirm the email arrives from the configured sender.
- **App mailer:**
  ```bash
  curl -X POST https://<app-host>/api/email/send \
    -H "X-Email-Send-Key: <EMAIL_SEND_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"to":"you@example.com","subject":"Test","text":"Hello from WasteZero"}'
  ```
- If nothing arrives, check the sending account's "Sent" folder first — a message stuck there (not an outright error) usually means an auth or app-password issue rather than a code issue.

For production env var management (Vercel), see [Users, GitHub, Supabase, and Vercel](./admin-platforms.md#navigating-vercel-app-hosting--github).
