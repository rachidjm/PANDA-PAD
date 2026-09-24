import { NextResponse } from "next/server";
import { getPauseState } from "@/lib/protocol/pause-store";
import { SUBSYSTEMS } from "@/lib/protocol/pause";
import { moneyFlowStatus } from "@/lib/config/launch-guard";
import { decideCoinCreation } from "@/lib/config/creation";
import { sessionsRevocable } from "@/lib/auth/session";
import { getLaunchLookupTable } from "@/lib/pump/launch-alt";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection } from "@solana/web3.js";

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
    // `singleTx`: a launch (coin + fee split) is one transaction only when PANDA's lookup table is configured AND readable now; else two.
    const creation = { ...decideCoinCreation(), singleTx: (await getLaunchLookupTable(new Connection(serverRpcUrl(), "confirmed"))) !== null };
    const state = await getPauseState();
    const paused = SUBSYSTEMS.flatMap((subsystem) => {
      const e = state.subsystems[subsystem];
      return e?.paused ? [{ subsystem, reason: e.reason, since: e.since }] : [];
    });
    return NextResponse.json({ paused, moneyFlows, creation, sessions: { revocable: sessionsRevocable() } }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } });
  } catch {
    return NextResponse.json({ paused: [], moneyFlows: { allowed: true }, creation: { allowed: true }, unavailable: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
