import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isOutage, PAUSED_PATH } from "@/lib/outage.js";

/**
 * Refreshes the Supabase session cookie and sends signed-out visitors to /login.
 *
 * This is NOT the security boundary. It is a session refresher and a friendly
 * redirect. Next.js has had a middleware-bypass vulnerability before
 * (CVE-2025-29927, a spoofable x-middleware-subrequest header); 16.3.3 is
 * patched, but a gate with a single layer is the wrong shape regardless.
 *
 * Every protected surface re-checks for itself:
 *   src/app/page.js                    requireUser()
 *   src/app/api/scan/[pageId]/route.js requireUser()   <- serves the images
 *   src/app/admin/page.js              requireAdmin()
 *   src/app/admin/actions.js           requireAdmin()
 */

// PAUSED_PATH is public because it is what an unreachable project redirects to:
// if it required a session it could only ever redirect to itself.
const PUBLIC_PATHS = ["/login", "/auth", PAUSED_PATH];

export async function middleware(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Refreshes an expiring token as a side effect; do not remove.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /*
   * An unreachable Supabase answers in exactly the shape of a signed-out
   * visitor: no user, plus an error. This `error` used to be discarded, so a
   * paused project sent everyone -- valid session included -- to the login
   * page, which then reported their password as wrong.
   *
   * Nothing can leak by letting these requests continue. Every byte of diary
   * content comes from the project that is down, so pages cannot read rows and
   * the scan route cannot mint a signed Storage URL. There is nothing to serve.
   */
  if (error && isOutage(error)) {
    if (pathname.startsWith("/api/")) return unavailable();
    if (isPublic) return response;

    const url = request.nextUrl.clone();
    url.pathname = PAUSED_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!user && !isPublic) {
    // /api is fetched by <img> and fetch(), never navigated to. Redirecting
    // those to the HTML login page hands an <img> a document to decode, so it
    // fails as a broken image with no clue why -- and it silently overrode the
    // 401 the scan route deliberately returns for exactly this case. Answer
    // them the way the routes themselves do.
    if (pathname.startsWith("/api/")) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

/**
 * 503 rather than the 401 a signed-out caller gets.
 *
 * An <img> breaks either way, but the status is the only place the reason
 * survives: "Unauthorized" sends you looking at your session, and Retry-After
 * says the honest thing, which is that waiting is the fix.
 */
function unavailable() {
  return new NextResponse("The diary is temporarily unavailable", {
    status: 503,
    headers: { "Retry-After": "300", "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
