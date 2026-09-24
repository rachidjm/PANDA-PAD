import { NextResponse } from "next/server";
import { getSession } from "./session";
import { checkAdmin, parseAdminWallets } from "./admin-policy";
import { recordAudit } from "@/lib/audit/log";

/**
 * Server-side admin gate — every /api/admin/* route calls this first; hiding
 * the /admin page is not the control. Returns the admin wallet, or the
 * response to send back. Refused attempts by a signed-in non-admin are audited.
 */
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
  if (verdict === "unauthenticated") return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}
