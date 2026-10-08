import type { NextConfig } from "next";

/**
 * Baseline security headers. `script-src` isn't locked down here on purpose:
 * Next's inline bootstrap scripts need per-request nonces to do that safely,
 * which is a separate change — so this is the subset that can't break the
 * app (clickjacking, MIME sniffing, plugin/base-tag injection, referrer and
 * device-API leakage, HTTPS downgrade).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

// The canonical domain — apex, no "www". Kept as a plain literal (not imported from src/lib/config/site.ts) so
// this file stays dependency-free, same as the rest of it — if NEXT_PUBLIC_SITE_URL is ever set to something
// else, update this to match. Every other host PANDA is reachable on (the old Vercel-assigned domain, and
// "www." — Vercel serves both of those as their own domain today, not as an automatic alias of this one)
// 301s here, path and query intact, so a referral link never dies just because of which host it was shared on.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://launchonpanda.app";
const CANONICAL_HOST = new URL(SITE_URL).host;
const OTHER_HOSTS = ["panda-pad.vercel.app", `www.${CANONICAL_HOST}`];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    // Coin images come from whichever host a feed (GeckoTerminal, Dexscreener, Pump.fun) or a creator's own
    // metadata happens to point at — an open set, not a handful of known hosts — so this mirrors the CSP's
    // own img-src ("https:", no allowlist) rather than trying to enumerate them.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    formats: ["image/webp"],
  },
  async redirects() {
    return OTHER_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `${SITE_URL}/:path*`,
      permanent: true,
    }));
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
