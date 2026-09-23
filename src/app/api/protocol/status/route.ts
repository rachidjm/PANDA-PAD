import { NextResponse } from "next/server";
import { getPauseState } from "@/lib/protocol/pause-store";
import { SUBSYSTEMS } from "@/lib/protocol/pause";
import { moneyFlowStatus } from "@/lib/config/launch-guard";
import { decideCoinCreation } from "@/lib/config/creation";

/**
 * Auth: none (public — users must be able to see why something is paused).
 * Output: { paused: [{ subsystem, reason, since }], moneyFlows: { allowed, reason? }, creation: { allowed, reason? }, unavailable?: true }.
 * `moneyFlows` is the network guard's answer (see src/lib/config/network.ts): only whether money may move and the
 * category of reason — never which variables are missing.
 * Only what's safe to publish: no admin wallet, nothing internal.
 */
export async function GET() {
  try {
    const flows = await moneyFlowStatus().catch(() => ({ blocking: true as const, reason: "network_unverified" as const }));
    const moneyFlows = flows.blocking ? { allowed: false, reason: flows.reason } : { allowed: true };
    const creation = decideCoinCreation();
    const state = await getPauseState();
    const paused = SUBSYSTEMS.flatMap((subsystem) => {
      const e = state.subsystems[subsystem];
      return e?.paused ? [{ subsystem, reason: e.reason, since: e.since }] : [];
    });
    return NextResponse.json({ paused, moneyFlows, creation }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } });
  } catch {
    return NextResponse.json({ paused: [], moneyFlows: { allowed: true }, creation: { allowed: true }, unavailable: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
