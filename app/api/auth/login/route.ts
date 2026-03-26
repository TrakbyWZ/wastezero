import {
  signSession,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/auth/schemas";

function parseCookieHeader(cookieHeader: string | null): { name: string; value: string }[] {
  if (!cookieHeader) return [];
  return cookieHeader.split(";").map((part) => {
    const eq = part.indexOf("=");
    const name = (eq === -1 ? part : part.slice(0, eq)).trim();
    const value = (eq === -1 ? "" : part.slice(eq + 1)).trim();
    return { name, value };
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg =
      first.email?.[0] ?? first.password?.[0] ?? "Invalid email or password.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const res = NextResponse.json({ ok: true, needsPasswordReset: false });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get("cookie"));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, { path: "/", ...options })
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  let needsPasswordReset = false;
  let appUserId: string | undefined;
  try {
    const admin = createAdminClient();
    const { data: userRow } = await admin
      .from("users")
      .select("id, needs_password_reset")
      .eq("email", normalizedEmail)
      .maybeSingle();
    needsPasswordReset = userRow?.needs_password_reset === true;
    appUserId = userRow?.id;
  } catch {
    // If we can't read the flag, client will send to batch; middleware will redirect to force-reset if needed.
  }

  const token = signSession({
    email: normalizedEmail,
    userId: appUserId,
  });
  const out = NextResponse.json({ ok: true, needsPasswordReset });
  // Copy every cookie from res (Supabase auth) so we don't lose any; then add app.session
  res.cookies.getAll().forEach((c) => {
    out.cookies.set(c.name, c.value, { path: "/" });
  });
  out.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());
  return out;
}
