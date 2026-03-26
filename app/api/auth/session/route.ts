import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  signSession,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * After Supabase password login, call this to set the app.session cookie
 * so protected routes and API routes that use getSession() recognize the user.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: appUser } = await admin
    .from("users")
    .select("id")
    .eq("email", user.email)
    .maybeSingle();

  const token = signSession({
    email: user.email,
    userId: appUser?.id,
  });
  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), token, getSessionCookieOptions());
  return NextResponse.json({ ok: true });
}
