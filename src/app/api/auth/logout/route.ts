import { NextResponse } from "next/server";
import { clearSessionCookie, getSession, revokeCurrentSession, sameOrigin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";

/**
 * Auth: none needed (ends the caller's own session). Clears the cookie AND, when sessions are revocable (PANDA_STORAGE_MODES sessions=dual|postgres),
 * revokes the session on the server, so a copied cookie stops working immediately instead of living out its 2 hours.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const session = await getSession(req);
  const revoked = await revokeCurrentSession(req, "logout");
  if (session && revoked) await recordAudit({ req, actor: session.wallet, action: "auth.logout", object: "session", newState: { jti: session.jti } });
  const res = NextResponse.json({ ok: true, revoked });
  clearSessionCookie(res);
  return res;
}
