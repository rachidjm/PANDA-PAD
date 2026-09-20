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

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
