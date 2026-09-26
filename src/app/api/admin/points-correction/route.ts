import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { isEnabled } from "@/lib/config/flags";
import { awardPoints } from "@/lib/points/store";
import { recordAudit } from "@/lib/audit/log";

/**
 * Auth: admin. Body: { wallet, points (non-zero integer, may be negative), correctsEventId,
 * correctionId (unique, makes the request idempotent), reason (required), confirm: "CORRECT POINTS" }.
 *
 * History is never edited: a finalized epoch is immutable. A correction is a NEW event in
 * the epoch that is ACTIVE right now, referencing the one it fixes. Gated by PANDA_POINTS.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const b = await req.json().catch(() => null);
  const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
  if (!b || b.confirm !== "CORRECT POINTS") return bad('Confirmation must be exactly "CORRECT POINTS".');
  if (typeof b.reason !== "string" || b.reason.trim().length < 5) return bad("A reason of at least 5 characters is required.");
  if (typeof b.correctionId !== "string" || !/^[A-Za-z0-9_.-]{4,64}$/.test(b.correctionId)) return bad("Invalid correctionId.");
  if (typeof b.correctsEventId !== "string" || b.correctsEventId.length < 8) return bad("correctsEventId is required.");
  if (typeof b.wallet !== "string" || !Number.isSafeInteger(b.points) || b.points === 0) return bad("Invalid wallet or points.");

  try {
    const r = await awardPoints({
      eventId: `correction:${b.correctionId}`,
      wallet: b.wallet,
      type: "correction",
      source: "admin",
      ts: Date.now(),
      points: b.points,
      correctsEventId: b.correctsEventId,
      reason: b.reason.trim().slice(0, 200),
    });
    if (r.outcome === "rejected") return bad(`Refused: ${r.reason}`);
    if (r.outcome === "recorded") {
      await recordAudit({
        req,
        actor: admin.wallet,
        action: "points.correction",
        object: b.wallet,
        newState: { points: b.points, correctsEventId: b.correctsEventId, epoch: r.epoch },
        reason: b.reason.trim(),
      });
    }
    return NextResponse.json({ outcome: r.outcome, epoch: r.epoch });
  } catch {
    return NextResponse.json({ error: "The correction failed — try again." }, { status: 500 });
  }
}
