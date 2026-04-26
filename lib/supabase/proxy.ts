import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { createAdminClient } from "./admin";

const PUBLIC_PATHS = ["/", "/login", "/force-reset", "/auth", "/api"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => p === pathname || (p !== "/" && pathname.startsWith(`${p}/`))
  );
}

/**
 * Next.js serves `public` by exact path: `public/docs/index.html` is at `/docs/index.html`, not
 * `/docs` or `/docs/`. Docusaurus emits `.../folder/index.html` for each page. Map pretty URLs
 * to those files so `/docs` and client-side doc routes work.
 */
function docusaurusRewriteToFile(pathname: string): string | null {
  if (pathname !== "/docs" && !pathname.startsWith("/docs/")) {
    return null;
  }
  if (pathname === "/docs" || pathname === "/docs/") {
    return "/docs/index.html";
  }
  if (pathname.startsWith("/docs/assets/") || pathname.startsWith("/docs/img/")) {
    return null;
  }
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  // sitemap.xml, app.js, foo.min.js, etc. (not doc folder routes)
  if (
    last.includes(".") &&
    !/\.html?$/i.test(last) &&
    /\.(js|mjs|map|json|ico|png|jpe?g|gif|svg|webp|woff2?|ttf|eot|xml|txt|webmanifest|pdf|csv|xsl|xslt)$/i.test(
      last,
    )
  ) {
    return null;
  }
  if (last.match(/\.html?$/i)) {
    return null; // already a file path
  }
  return `${pathname.replace(/\/$/, "")}/index.html`;
}

function isDocsPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  if (!hasEnvVars) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session (must run immediately after createServerClient).
  await supabase.auth.getClaims();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  const email = user?.email?.trim().toLowerCase() ?? null;

  // /protected uses app.session cookie (set after Supabase auth via /api/auth/session).
  // Let the protected layout handle redirect to /auth/login when no session.
  // API routes must not be redirected or the client gets HTML instead of JSON.
  const path = request.nextUrl.pathname;
  const isPublic = isPublicPath(path);

  // Validation Step A: Not authenticated → redirect to login for protected routes.
  if (!user) {
    if (!isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Validation Step B: Check public.users allow-list.
  let allowListRow: { is_active: boolean; needs_password_reset: boolean } | null = null;
  let allowListCheckSucceeded = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("users")
      .select("is_active, needs_password_reset")
      .eq("email", email ?? "")
      .maybeSingle();
    if (!error) {
      allowListCheckSucceeded = true;
      allowListRow = data;
    }
  } catch {
    // Admin client or network error; allow request through so we don't log out valid users.
  }

  // Not on allow-list → sign out and redirect to login (only when we successfully queried).
  if (allowListCheckSucceeded && !allowListRow) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Validation Step C: Inactive user → sign out and redirect (only when we have a row).
  if (allowListRow && !allowListRow.is_active) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "inactive");
    return NextResponse.redirect(url);
  }

  // Validation Step D: Must reset password → only /force-reset allowed.
  if (allowListRow && allowListRow.needs_password_reset && path !== "/force-reset" && !path.startsWith("/force-reset/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/force-reset";
    return NextResponse.redirect(url);
  }

  if (isDocsPath(path)) {
    const docusaurusPath = docusaurusRewriteToFile(path);
    if (docusaurusPath != null) {
      const res = NextResponse.rewrite(
        new URL(docusaurusPath, request.nextUrl),
        { request },
      );
      for (const c of supabaseResponse.cookies.getAll()) {
        res.cookies.set(c);
      }
      return res;
    }
  }

  return supabaseResponse;
}
