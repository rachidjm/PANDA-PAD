import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { requireAdmin } from "@/lib/auth/admin";
import { revokeAllSessions, sameOrigin, sessionsRevocable } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";
import { clientIp, rateLimited } from "@/lib/rate-limit";

/**
 * Auth: admin. Body: { wallet, reason }. Ends every live session of a (suspicious) wallet at once. Audited and alerted.
 * Fail-open on the rate limiter on purpose (see src/lib/rate-limit.ts): an admin must be able to act during an outage.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (!sessionsRevocable()) return NextResponse.json({ error: "Sessions aren't revocable yet (PANDA_STORAGE_MODES sessions=dual or postgres)." }, { status: 409 });

  const body = await req.json().catch(() => null);
  let wallet: string;
  try {
    wallet = new PublicKey(body?.wallet).toBase58();
  } catch {
    return NextResponse.json({ error: "Invalid wallet." }, { status: 400 });
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  if (reason.length < 3) return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  try {
    const count = await revokeAllSessions(wallet, `admin: ${reason}`);
    await recordAudit({ req, actor: admin.wallet, action: "admin.revoke_sessions", object: wallet, newState: { count }, reason });
    await alertOps("Sessions revoked by an admin", { by: admin.wallet, wallet, count, reason });
    return NextResponse.json({ wallet, revoked: count });
  } catch {
    return NextResponse.json({ error: "Couldn't revoke — try again." }, { status: 500 });
  }
}
