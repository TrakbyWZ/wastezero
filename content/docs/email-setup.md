# Sending email via Microsoft Graph (Office 365)

This app sends email through the client's Office 365 tenant using **Microsoft Graph's `sendMail` API** with an **Entra ID app registration** (OAuth2 client-credentials) — not SMTP. This was chosen over SMTP AUTH + app password because the client's tenant enforces modern auth; Graph is also Microsoft's recommended approach going forward regardless.

**Important:** Supabase Auth's own built-in mailer (its dashboard-triggered "Send password recovery" action) only supports basic-auth SMTP — it has no OAuth2 support, so it **cannot** use this app registration. Password resets are therefore sent by the app itself (see [§3](#3-password-reset-emails-bypass-supabase)), not through Supabase.

| Mailer | Sends | Configured in |
| ------ | ----- | ------------- |
| **App mailer** (`lib/email.ts`) | All app-sent email: `/api/email/send`, and password-reset emails from `lib/auth/password-reset.ts` (used by both the self-service "Forgot password?" flow and `scripts/send-password-reset.ts`) | `MS_*` env vars in `.env.local` / Vercel project env vars |
| ~~Supabase Auth SMTP~~ | Not used | N/A — bypassed; see below |

Without `MS_*` configured, `lib/email.ts` logs to console instead of sending (dev fallback).

---

## 1. Ask the client's IT admin to register an Entra ID app

Send them the request below. They'll need **Global Administrator** or **Application Administrator** in the Microsoft 365 tenant.

> **Register an app for Trak to send email via Microsoft Graph**
>
> 1. **Entra admin center** (`entra.microsoft.com`) → **Identity** → **Applications** → **App registrations** → **New registration**.
>    - Name: e.g. `Trak Email Sender`
>    - Supported account types: **Single tenant** (this organization only)
>    - Leave Redirect URI blank (this app authenticates app-only, no user sign-in)
> 2. Note the **Directory (tenant) ID** and **Application (client) ID** from the app's Overview page.
> 3. **Certificates & secrets** → **New client secret** → copy the **Value** immediately (it's only shown once). Note its expiry — it will need to be rotated before then.
> 4. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** (not Delegated) → add **`Mail.Send`** → **Grant admin consent** for the tenant.
> 5. **Restrict which mailbox the app can send as** (important — without this, `Mail.Send` lets the app send as *any* mailbox in the tenant). In Exchange Online PowerShell:
>    ```powershell
>    New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId <sender-mailbox-email> -AccessRight RestrictAccess -Description "Trak email sender"
>    ```
> 6. Decide the **designated sender mailbox** (e.g. `no-reply@clientdomain.com`) — it must be a real, licensed mailbox.
>
> Send back:
> 1. **Directory (tenant) ID**
> 2. **Application (client) ID**
> 3. **Client secret value**
> 4. **Designated sender email address**

---

## 2. Configure the app mailer

Set in `.env.local` (local) or Vercel **Settings → Environment Variables** (hosted):

| Variable | Value |
| -------- | ----- |
| `MS_TENANT_ID` | Directory (tenant) ID |
| `MS_CLIENT_ID` | Application (client) ID |
| `MS_CLIENT_SECRET` | Client secret value |
| `MS_SENDER_EMAIL` | Designated sender mailbox |
| `EMAIL_SEND_API_KEY` | any strong random value — required by `/api/email/send` as the `X-Email-Send-Key` header |
| `APP_URL` | the app's origin (e.g. `https://trak.clientdomain.com`) — used to build links in admin-sent emails |

`lib/email.ts` exchanges the client secret for a Graph access token (client-credentials grant, cached until near expiry) and POSTs to `https://graph.microsoft.com/v1.0/users/{MS_SENDER_EMAIL}/sendMail`.

---

## 3. Password-reset emails bypass Supabase

Supabase Auth's SMTP settings can't use this app registration, so resets are triggered from the app side instead of Supabase's dashboard, via `lib/auth/password-reset.ts` — used by both the self-service **Forgot password?** form on the login page (`app/api/auth/forgot-password/route.ts`) and the admin CLI (`pnpm reset-password --linked <email>`). See [Resetting a user's password](./admin-platforms.md#resetting-a-users-password) for the full operator flow.

Either path calls `supabase.auth.admin.generateLink({ type: "recovery", email })` to get a token (only for emails matching an **active `public.users` row** — this app's allow-list, not just any Supabase Auth user), builds the same `/auth/confirm?token_hash=...&type=recovery` URL the app already handles (`app/auth/confirm/route.ts` → `app/auth/update-password/`), and emails an HTML-rendered link (`lib/email-templates.ts`) via the Graph mailer above.

**One-time setup:** the `redirectTo` used (`${APP_URL}/auth/update-password`) must be in Supabase's **Authentication → URL Configuration → Redirect URLs** allow-list, per environment.

---

## 4. Test

```bash
curl -X POST https://<app-host>/api/email/send \
  -H "X-Email-Send-Key: <EMAIL_SEND_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"to":"you@example.com","subject":"Test","text":"Hello from WasteZero"}'

pnpm reset-password --local you@example.com
```

If Graph returns `401`/`403`, the most common causes are: admin consent not granted for `Mail.Send`, or the Application Access Policy in step 1.5 doesn't include the sender mailbox. If nothing arrives but no error is thrown, check the sender mailbox's "Sent Items" — Graph delivers as that mailbox, so it should show there too.

For production env var management (Vercel), see [Users, GitHub, Supabase, and Vercel](./admin-platforms.md#navigating-vercel-app-hosting--github).
