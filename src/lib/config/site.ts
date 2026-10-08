/**
 * PANDA's own public URL — the single source of truth for everything that has to say where the site lives
 * (OG/canonical metadata, the sitemap, robots.txt, the Recruiters legal text's example link, the admin
 * simulate-launch metadata fallback). Configurable via NEXT_PUBLIC_SITE_URL so a staging/preview deployment
 * (or a future domain change) never needs a code change — see docs on NEXT_PUBLIC_SITE_URL in env.ts.
 */
const DEFAULT_SITE_URL = "https://launchonpanda.app";

export function siteUrl(): string {
  const v = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!v) return DEFAULT_SITE_URL;
  try {
    return new URL(v).origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** The bare hostname, e.g. "launchonpanda.app" — for places that show it as text rather than a link. */
export function siteDomain(): string {
  return siteUrl().replace(/^https?:\/\//, "");
}
