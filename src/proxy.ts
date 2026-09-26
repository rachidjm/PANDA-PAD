import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspHeaderName, cspMode, newNonce, CSP_REPORT_PATH } from "@/lib/security/csp";
import { adminGatePasses, isAdminOnlyPath } from "@/lib/auth/admin-gate";

/**
 * 1. Admin-only paths (/admin, /api/admin/*, /api/health/*): without a session cookie of a listed admin wallet the request is rewritten to a
 *    path that doesn't exist, so the answer is the site's ordinary 404 — for any method, any sub-path — and nothing reveals the console.
 *    Routes and pages re-check the live session themselves; this is the first, cheap layer.
 * 2. Sets a per-request nonce and the Content-Security-Policy (report-only by default, see src/lib/security/csp.ts). Next reads the nonce
 *    from the request's CSP header and applies it to its own scripts; pages must be rendered per request for that (the root layout opts in).
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  let hidden = false;
  if (isAdminOnlyPath(path)) {
    const ok = adminGatePasses(request.cookies.get("panda_session")?.value, { secret: process.env.AUTH_SESSION_SECRET, admins: process.env.ADMIN_WALLETS }, Date.now());
    if (!ok) hidden = true;
    else if (path.startsWith("/api/")) return NextResponse.next();
  }
  // The hidden 404 is a page like any other missing one, so it gets the same headers (an API path has none to give).
  const notFound = () => NextResponse.rewrite(new URL("/_hidden-404", request.url), { status: 404 });
  if (hidden && path.startsWith("/api/")) return notFound();

  const mode = cspMode();
  if (mode === "off") return hidden ? notFound() : NextResponse.next();

  const nonce = newNonce();
  const policy = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", enforce: mode === "enforce" });
  const header = cspHeaderName(mode);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(header, policy);

  const response = hidden ? NextResponse.rewrite(new URL("/_hidden-404", request.url), { status: 404, request: { headers: requestHeaders } }) : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  response.headers.set("Reporting-Endpoints", `csp-endpoint="${CSP_REPORT_PATH}"`);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not API routes, static assets, images or prefetches.
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    // The admin-only paths are always checked, prefetches and API routes included.
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/health/:path*",
  ],
};
