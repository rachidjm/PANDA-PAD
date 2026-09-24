import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspHeaderName, cspMode, newNonce, CSP_REPORT_PATH } from "@/lib/security/csp";

/**
 * Sets a per-request nonce and the Content-Security-Policy (report-only by default, see src/lib/security/csp.ts). Next reads the nonce from
 * the request's CSP header and applies it to its own scripts; pages must be rendered per request for that (the root layout opts in).
 */
export function proxy(request: NextRequest) {
  const mode = cspMode();
  if (mode === "off") return NextResponse.next();

  const nonce = newNonce();
  const policy = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", enforce: mode === "enforce" });
  const header = cspHeaderName(mode);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(header, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
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
  ],
};
