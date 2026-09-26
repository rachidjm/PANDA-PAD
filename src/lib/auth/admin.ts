import { NextResponse } from "next/server";
import { getSession } from "./session";
import { checkAdmin, parseAdminWallets } from "./admin-policy";
import { recordAudit } from "@/lib/audit/log";

/**
 * Server-side admin gate — every /api/admin/* route calls this FIRST (before any origin or rate-limit check, so nothing answers a
 * stranger differently); hiding the /admin page is not the control. Returns the admin wallet, or the response to send back.
 *
 * Anyone who is not a listed admin with a live session gets a bare 404: no body, no hint that the route exists. Only a wallet that IS
 * listed as an admin, whose session is older than ADMIN_FRESH_MS, hears "sign in again" (401): it has already proven it is an admin.
 * Refused attempts by a signed-in non-admin are audited.
 */

/** The answer for every stranger: an empty 404, the same as a path that doesn't exist. */
export const hiddenResponse = () => new NextResponse(null, { status: 404 });

export async function requireAdmin(req: Request): Promise<{ wallet: string } | NextResponse> {
  const session = await getSession(req);
  const verdict = checkAdmin(session, parseAdminWallets(process.env.ADMIN_WALLETS), Date.now());
  if (verdict === "ok" && session) return { wallet: session.wallet };

  if (session && verdict === "not_admin") {
    await recordAudit({ req, actor: session.wallet, action: "admin.denied", object: new URL(req.url).pathname, reason: verdict });
  }
  if (verdict === "stale_session") {
    return NextResponse.json({ error: "Sign in again to confirm this admin action.", code: "REAUTH_REQUIRED" }, { status: 401 });
  }
  return hiddenResponse(); // unauthenticated or not an admin: indistinguishable from a route that doesn't exist
}

/**
 * Whether these request headers carry a live session of a listed admin wallet (stale or not: a stale one may still open the page to
 * sign in again). Used by the /admin page, which shows a 404 to everyone else.
 */
export async function isAdminRequest(cookieHeader: string | null): Promise<boolean> {
  const req = new Request("https://panda.internal/admin", cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
  const session = await getSession(req);
  const verdict = checkAdmin(session, parseAdminWallets(process.env.ADMIN_WALLETS), Date.now());
  return verdict === "ok" || verdict === "stale_session";
}
