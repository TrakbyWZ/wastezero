import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionCookieName, getSessionCookieOptions } from "@/lib/session";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getSessionCookieName(), "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
  return res;
}
