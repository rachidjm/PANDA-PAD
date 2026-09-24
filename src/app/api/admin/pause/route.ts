import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { confirmationPhrase, isSubsystem, validateReason } from "@/lib/protocol/pause";
import { setPause } from "@/lib/protocol/pause-store";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";

/**
 * Auth: admin (fresh wallet session of an ADMIN_WALLETS wallet).
 * Body: { subsystem, paused: boolean, reason, confirm } where `confirm` must be
 * exactly "PAUSE <subsystem>" / "RESUME <subsystem>".
 * Effect: flips one subsystem's switch. Audited and alerted; deletes nothing.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const body = await req.json().catch(() => null);
  const { subsystem, paused, reason, confirm } = body ?? {};
  if (!isSubsystem(subsystem) || typeof paused !== "boolean") {
    return NextResponse.json({ error: "Invalid subsystem or state." }, { status: 400 });
  }
  const reasonError = validateReason(paused, reason);
  if (reasonError) return NextResponse.json({ error: reasonError }, { status: 400 });
  if (confirm !== confirmationPhrase(paused, subsystem)) {
    return NextResponse.json({ error: `Confirmation must be exactly "${confirmationPhrase(paused, subsystem)}".` }, { status: 400 });
  }

  try {
    const { before, after, changed } = await setPause(subsystem, paused, typeof reason === "string" ? reason : "", admin.wallet);
    if (changed) {
      await recordAudit({
        req,
        actor: admin.wallet,
        action: paused ? "protocol.pause" : "protocol.resume",
        object: subsystem,
        oldState: before,
        newState: after,
        reason: typeof reason === "string" ? reason : undefined,
      });
      await alertOps(`Protocol ${paused ? "PAUSED" : "resumed"}: ${subsystem}`, { by: admin.wallet, reason });
    }
    return NextResponse.json({ subsystem, paused, changed });
  } catch {
    return NextResponse.json({ error: "Couldn't update the pause state — try again." }, { status: 500 });
  }
}
