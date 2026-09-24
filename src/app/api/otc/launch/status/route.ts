import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getOtcLaunch, transitionOtcLaunch } from "@/lib/otc/store";
import { isPlausibleSignature } from "@/lib/otc/validate";
import type { OtcLaunchStatus } from "@/lib/otc/types";

/**
 * Bookkeeping only — records what the browser's own wallet flow did (build the two OTC
 * transactions, sign them, send TX1, wait for it, send TX2, wait for it) against PANDA's launch
 * record. Nothing here sends a transaction or holds a key; the client already confirmed each
 * signature itself the same way PANDA Standard does (src/lib/solana/confirm.ts). Each event is only
 * accepted from the specific prior status it's supposed to follow — see rule #13 in spirit: once a
 * real signature exists for a step, a client can't casually overwrite it or mark the launch FAILED
 * out from under it.
 */

type Event = "tx1_pending" | "tx1_confirmed" | "tx2_pending" | "tx2_confirmed" | "failed";

const TRANSITIONS: Record<Event, { from: readonly OtcLaunchStatus[]; to: OtcLaunchStatus }> = {
  tx1_pending: { from: ["AWAITING_SIGNATURE"], to: "TX1_PENDING" },
  tx1_confirmed: { from: ["TX1_PENDING"], to: "TX1_CONFIRMED" },
  tx2_pending: { from: ["TX1_CONFIRMED"], to: "TX2_PENDING" },
  tx2_confirmed: { from: ["TX2_PENDING"], to: "CONFIRMED" },
  // Allowed any time before TX2 is actually sent: TX1 only creates the pool config, not the coin
  // itself (the mint keypair only signs TX2), so an abandoned config after TX1 is a real but harmless
  // dead end. Once TX2_PENDING (a real TX2 signature exists), a client report can no longer mark this
  // FAILED — the coin may already be real and earning even if the client's own wait failed.
  failed: { from: ["VALIDATING", "METADATA_CREATED", "LAUNCH_BUILDING", "AWAITING_SIGNATURE", "TX1_PENDING", "TX1_CONFIRMED"], to: "FAILED" },
};

export async function POST(req: Request) {
  const disabled = featureDisabledResponse("OTC_REWARDS");
  if (disabled) return disabled;
  if (await rateLimited(`otc-status:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  try {
    const { mint, event, signature, error } = await req.json();
    if (typeof mint !== "string" || !mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });
    if (!(event in TRANSITIONS)) return NextResponse.json({ error: "Unknown event." }, { status: 400 });
    if ((event === "tx1_pending" || event === "tx2_pending") && !isPlausibleSignature(signature)) {
      return NextResponse.json({ error: "Missing or invalid signature." }, { status: 400 });
    }

    const { from, to } = TRANSITIONS[event as Event];
    const patch: Record<string, unknown> = { status: to };
    if (event === "tx1_pending") patch.tx1Signature = signature;
    if (event === "tx2_pending") patch.tx2Signature = signature;
    if (event === "failed" && typeof error === "string") patch.error = error.slice(0, 300);

    const updated = await transitionOtcLaunch(mint, from, patch, Date.now());
    if (!updated) {
      const current = await getOtcLaunch(mint);
      return NextResponse.json(
        { error: current ? `This launch is at "${current.status}", can't apply "${event}".` : "No launch found for this mint.", launch: current },
        { status: 409 }
      );
    }
    return NextResponse.json({ launch: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
