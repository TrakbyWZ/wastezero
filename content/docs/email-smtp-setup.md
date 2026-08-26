# Sending real email with Office 365 SMTP

This app has **two independent mailers** — wiring up the client's Office 365 mailbox means configuring **both**, or one flow will send email while the other silently doesn't.

| Mailer | Sends | Configured in |
| ------ | ----- | ------------- |
| **Supabase Auth SMTP** | Password-reset links (`resetPasswordForEmail` in [`forgot-password-form.tsx`](../../components/forgot-password-form.tsx)), and any other built-in Supabase Auth email (invites, email-change confirmation) | Supabase **Dashboard** (hosted) or `[auth.email.smtp]` in `supabase/config.toml` (local) |
| **App mailer** (`lib/email.ts`, nodemailer) | Plain-text email sent via `/api/email/send`, called internally by app flows | `SMTP_*` env vars in `.env.local` / Vercel project env vars |

Without SMTP configured: Supabase Auth emails silently fail/queue per its own rules, and the app mailer logs to console instead of sending (see `lib/email.ts`).

---

## 0. Check the prerequisite first: is SMTP AUTH allowed on the tenant?

Microsoft 365 disables **Authenticated SMTP** (SMTP AUTH / basic auth client submission) on many mailboxes by default, and some tenants block basic auth entirely via Security Defaults or Conditional Access. This is the #1 reason Office 365 SMTP setups fail, so confirm it **before** generating an app password.

A tenant admin needs to:

1. **Exchange Admin Center** → **Users** → **Active users** → select the sending mailbox → **Mail** tab → **Manage email apps** → ensure **Authenticated SMTP** is turned **on**.
   - Or via PowerShell: `Set-CASMailbox -Identity <mailbox> -SmtpClientAuthenticationDisabled $false`
2. Confirm **Security Defaults** (Azure AD) or any **Conditional Access** policy isn't blocking legacy/basic authentication for this account. If it is, either exclude the mailbox or use a Conditional Access policy scoped to allow SMTP AUTH for it.
3. The account needs **MFA enabled** to be eligible for an **app password** (step 1 below) — or use a dedicated, non-interactive "service" mailbox the client controls, if their tenant policy allows it.

If the tenant has **fully disabled basic auth with no exceptions** (increasingly common on newly-provisioned tenants), SMTP AUTH will not work at all — that requires the OAuth 2.0 / Microsoft Graph `sendMail` approach instead, which is more setup (an Azure AD app registration with `Mail.Send` permission and a code change to both mailers to use OAuth2/Graph rather than SMTP). Flag this back if step 0 comes back blocked — it's a separate, larger task from what's documented below.

---

## 1. Get SMTP credentials

1. Enable 2-Step Verification / MFA on the sending mailbox (Azure AD / Microsoft 365 admin center), if not already on.
2. Create an app password for that account:
   - Microsoft 365 admin center → **Users** → select the user → **Reset password** area has an app passwords option, or the user self-serves at `mysignins.microsoft.com/security-info` → **Add sign-in method** → **App password**.
3. SMTP settings:
   - Host: `smtp.office365.com`
   - Port: `587` (STARTTLS — Office 365 does not support implicit TLS on 465)
   - Username: the full mailbox address (e.g. `no-reply@clientdomain.com`)
   - Password: the app password from step 2
4. Limits: Microsoft 365 mailboxes are typically capped around 10,000 recipients/day and 30 messages/minute — plenty for password-reset and low-volume app email, not a substitute for a transactional provider at real scale.

---

## 2. Configure Supabase Auth SMTP (password-reset emails)

Reference: [Supabase custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

**Hosted project:**

1. Supabase Dashboard → your project → **Authentication** → **Emails** → **SMTP Settings**.
2. Toggle **Enable Custom SMTP** and fill in:
   - Sender email — the Office 365 mailbox address
   - Sender name — e.g. `WasteZero`
   - Host: `smtp.office365.com`, Port: `587`, Username/Password — from step 1 above
3. Save. Supabase applies a default rate limit (30 emails/hour) — raise it under **Authentication** → **Rate Limits** if the client needs more.

**Local dev** (`supabase/config.toml`, only if you want real emails locally instead of Inbucket/Mailpit):

```toml
[auth.email.smtp]
enabled = true
host = "smtp.office365.com"
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
| `SMTP_HOST` | `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` (Office 365 uses STARTTLS on 587, not implicit TLS) |
| `SMTP_USER` | the Office 365 mailbox address |
| `SMTP_PASSWORD` | the app password from step 1 |
| `OTP_FROM_EMAIL` | e.g. `WasteZero <no-reply@clientdomain.com>` |
| `EMAIL_SEND_API_KEY` | any strong random value — required by `/api/email/send` as the `X-Email-Send-Key` header |

The same Office 365 mailbox and app password are reused for both mailers — just repeat the credentials from step 1 in both places.

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
- If nothing arrives, check the sending mailbox's "Sent" folder first — a message stuck there (rather than an outright SMTP error) usually means Authenticated SMTP is still disabled for that mailbox (revisit step 0) rather than a code issue.

For production env var management (Vercel), see [Users, GitHub, Supabase, and Vercel](./admin-platforms.md#navigating-vercel-app-hosting--github).
