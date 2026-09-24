/**
 * Content-Security-Policy with per-request nonces (phase 6, point 5). Pure functions: the proxy (src/proxy.ts) calls them.
 *
 * script-src is the point: only scripts carrying this request's random nonce (and what they load, via 'strict-dynamic') may run, so an
 * injected <script> or inline handler is refused by the browser. Rollout is REPORT-ONLY first (CSP_MODE=report-only, the default): the
 * browser reports what it WOULD block to /api/csp-report and blocks nothing, so wallet extensions, images and fonts can be checked
 * against real traffic for 1–2 weeks before CSP_MODE=enforce.
 */
export type CspMode = "off" | "report-only" | "enforce";

export function cspMode(env: Record<string, string | undefined> = process.env): CspMode {
  const v = env.CSP_MODE?.trim().toLowerCase();
  return v === "enforce" || v === "off" ? v : "report-only";
}

export const CSP_REPORT_PATH = "/api/csp-report";

export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function buildCsp({ nonce, dev = false, enforce = false }: { nonce: string; dev?: boolean; enforce?: boolean }): string {
  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' only in development (React's debugging). In production neither React nor Next uses eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Tailwind/Next set inline style attributes, which a nonce can't cover: 'unsafe-inline' for styles only (scripts stay strict).
    "style-src 'self' 'unsafe-inline'",
    // Coin logos come from third-party hosts; data:/blob: for previews (Create) and generated images.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // The browser only talks to PANDA itself (chain reads and sends go through /api/rpc).
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    "report-to csp-endpoint",
  ];
  if (enforce) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export const cspHeaderName = (mode: CspMode) => (mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only");

// ── violation reports ────────────────────────────────────────────────────────────────────────────────────────────────
export type Violation = { directive: string; blocked: string; page: string; source: string };

const stripUrl = (raw: unknown): string => {
  if (typeof raw !== "string" || !raw) return "";
  if (["inline", "eval", "data", "blob", "self", "wasm-eval", "trusted-types-policy", "trusted-types-sink"].includes(raw)) return raw;
  try {
    const u = new URL(raw);
    // Origin only for what was blocked (a full URL could carry a query with personal data); path only for our own pages.
    return u.protocol === "data:" || u.protocol === "blob:" ? u.protocol.slice(0, -1) : u.origin;
  } catch {
    return raw.slice(0, 40);
  }
};
const pagePath = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  try {
    return new URL(raw).pathname.slice(0, 80);
  } catch {
    return "";
  }
};

/** Understands both report formats (legacy `csp-report` and the Reporting API list). Returns [] for anything else. */
export function parseViolations(body: unknown): Violation[] {
  const items: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const r of body) if (r && typeof r === "object" && (r as { type?: unknown }).type === "csp-violation" && (r as { body?: unknown }).body) items.push((r as { body: Record<string, unknown> }).body);
  } else if (body && typeof body === "object" && (body as { "csp-report"?: unknown })["csp-report"]) {
    items.push((body as { "csp-report": Record<string, unknown> })["csp-report"]);
  }
  return items.slice(0, 20).map((b) => ({
    directive: String(b.effectiveDirective ?? b["effective-directive"] ?? b.violatedDirective ?? b["violated-directive"] ?? "unknown").split(" ")[0].slice(0, 40),
    blocked: stripUrl(b.blockedURL ?? b["blocked-uri"]) || "unknown",
    page: pagePath(b.documentURL ?? b["document-uri"]),
    source: stripUrl(b.sourceFile ?? b["source-file"]),
  }));
}
