import { NextResponse } from "next/server";
import { clearSessionCookie, getSession, revokeAllSessions, sameOrigin, sessionsRevocable } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";

/** Auth: a live session. "Close all my sessions": every session of the signed-in wallet, on every device, ends at once (this one included). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`auth-revoke:ip:${clientIp(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!sessionsRevocable()) return NextResponse.json({ error: "Sessions can't be revoked on this deployment yet.", code: "NOT_REVOCABLE" }, { status: 409 });
  try {
    const count = await revokeAllSessions(session.wallet, "user: close all sessions");
    await recordAudit({ req, actor: session.wallet, action: "auth.revoke_all", object: "sessions", newState: { count } });
    const res = NextResponse.json({ revoked: count });
    clearSessionCookie(res);
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't close the sessions — try again." }, { status: 500 });
  }
}
