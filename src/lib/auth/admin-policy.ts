/**
 * Who may perform admin actions — pure decision logic. Admins are wallets
 * listed in the server-only ADMIN_WALLETS env var. An admin action needs a
 * wallet session that is BOTH for a listed wallet AND recent (the wallet
 * signed in within ADMIN_FRESH_MS), so a stolen or forgotten 2-hour session
 * can't be used for critical changes. An empty list means nobody is admin.
 */

export const ADMIN_FRESH_MS = 30 * 60_000;

export function parseAdminWallets(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export type AdminVerdict = "ok" | "unauthenticated" | "not_admin" | "stale_session";

export function checkAdmin(
  session: { wallet: string; issuedAt: number } | null,
  admins: Set<string>,
  now: number
): AdminVerdict {
  if (!session) return "unauthenticated";
  if (!admins.has(session.wallet)) return "not_admin";
  if (now - session.issuedAt > ADMIN_FRESH_MS || session.issuedAt > now + 60_000) return "stale_session";
  return "ok";
}
