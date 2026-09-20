import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { isEnabled } from "@/lib/config/flags";
import { EPOCH_STATUSES, EpochStatus } from "@/lib/epochs/epoch";
import { createEpoch, finalizeEpoch, getEpochs, transitionEpoch } from "@/lib/points/store";
import { pausedResponse } from "@/lib/protocol/guard";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";

/**
 * Auth: admin (fresh wallet session of an ADMIN_WALLETS wallet), same-origin.
 * GET  -> all epochs (full detail).
 * POST -> one of, each requiring an exact `confirm` phrase:
 *   { action: "create", startTime, snapshotTime, endTime, rewardPool, confirm: "CREATE EPOCH" }
 *   { action: "transition", epochId, to, reason?, confirm: "<TO> EPOCH <id>" }        e.g. "ACTIVE EPOCH 3"
 *   { action: "finalize", epochId, confirm: "FINALIZE EPOCH <id>" }                    CALCULATING -> FINALIZED, pins totals
 * Everything is audited. Moves into CALCULATING/FINALIZED also respect the
 * `reward_calculations` pause switch. Gated by the PANDA_POINTS flag.
 */
export async function GET(req: Request) {
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ epochs: await getEpochs() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load epochs." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const body = await req.json().catch(() => null);
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!body || typeof body.action !== "string") return bad("Invalid request.");
  const now = Date.now();

  try {
    if (body.action === "create") {
      if (body.confirm !== "CREATE EPOCH") return bad('Confirmation must be exactly "CREATE EPOCH".');
      const r = await createEpoch(
        { startTime: body.startTime, snapshotTime: body.snapshotTime, endTime: body.endTime, rewardPool: body.rewardPool },
        now
      );
      if (!r.ok) return bad(r.error);
      await recordAudit({ req, actor: admin.wallet, action: "epoch.create", object: `epoch:${r.epoch.id}`, newState: r.epoch });
      return NextResponse.json({ epoch: r.epoch });
    }

    if (!Number.isSafeInteger(body.epochId) || body.epochId < 1) return bad("Invalid epoch.");
    const id: number = body.epochId;

    if (body.action === "transition") {
      const to = body.to as EpochStatus;
      if (!EPOCH_STATUSES.includes(to) || to === "FINALIZED") return bad("Invalid target status (FINALIZED has its own finalize action).");
      if (to === "DISTRIBUTING") {
        // Only ever entered by publishing the airdrop; the one thing allowed here is RESUMING a paused distribution.
        const current = (await getEpochs()).find((e) => e.id === id);
        if (!(current?.status === "PAUSED" && current.pausedFrom === "DISTRIBUTING")) {
          return bad("DISTRIBUTING is entered by publishing the airdrop, not by a manual transition.");
        }
      }
      if (body.confirm !== `${to} EPOCH ${id}`) return bad(`Confirmation must be exactly "${to} EPOCH ${id}".`);
      if (to === "CALCULATING") {
        const paused = await pausedResponse("reward_calculations");
        if (paused) return paused;
      }
      const r = await transitionEpoch(id, to, now);
      if (!r.ok) return bad(r.error, 409);
      await recordAudit({
        req,
        actor: admin.wallet,
        action: "epoch.transition",
        object: `epoch:${id}`,
        oldState: { status: r.before.status },
        newState: { status: r.after.status },
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      return NextResponse.json({ epoch: r.after });
    }

    if (body.action === "finalize") {
      if (body.confirm !== `FINALIZE EPOCH ${id}`) return bad(`Confirmation must be exactly "FINALIZE EPOCH ${id}".`);
      const paused = await pausedResponse("reward_calculations");
      if (paused) return paused;
      const r = await finalizeEpoch(id, now);
      if (!r.ok) {
        await alertOps("Epoch finalization refused", { epoch: id, error: r.error });
        return bad(r.error, 409);
      }
      await recordAudit({
        req,
        actor: admin.wallet,
        action: "epoch.finalize",
        object: `epoch:${id}`,
        newState: { totalsHash: r.totals.hash, wallets: r.totals.entries.length, totalPoints: r.totals.totalPoints },
      });
      return NextResponse.json({ epoch: r.epoch, totalsHash: r.totals.hash, wallets: r.totals.entries.length, totalPoints: r.totals.totalPoints });
    }

    return bad("Unknown action.");
  } catch (err) {
    console.error("[PANDA] admin epochs failed", String(err));
    return bad("The operation failed — nothing was changed, or the state needs checking.", 500);
  }
}
