import { readSessionToken } from "./wallet-auth";
import { parseAdminWallets } from "./admin-policy";

/**
 * The coarse first gate for everything admin (see src/proxy.ts): paths that only a listed admin may even reach. It looks at the session
 * cookie alone (signature, expiry, wallet in ADMIN_WALLETS) — no database — so a stranger, a bot and a scanner all get the site's ordinary
 * 404 without touching any route. It is NOT the authority: pages and routes still check the live session (revocation, freshness) themselves.
 */

/** Path prefixes reserved for admins. `/api/health` reports internal state (env presence, treasury, database, Upstash). */
export const ADMIN_ONLY_PREFIXES = ["/admin", "/api/admin", "/api/health"] as const;

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function adminGatePasses(sessionCookie: string | undefined, env: { secret: string | undefined; admins: string | undefined }, now: number): boolean {
  if (!env.secret || env.secret.length < 32) return false;
  const parsed = readSessionToken(sessionCookie, env.secret, now);
  return !!parsed && parseAdminWallets(env.admins).has(parsed.wallet);
}
