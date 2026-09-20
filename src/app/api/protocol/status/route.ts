import { NextResponse } from "next/server";
import { getPauseState } from "@/lib/protocol/pause-store";
import { SUBSYSTEMS } from "@/lib/protocol/pause";

/**
 * Auth: none (public — users must be able to see why something is paused).
 * Output: { paused: [{ subsystem, reason, since }], unavailable?: true }.
 * Only what's safe to publish: no admin wallet, nothing internal.
 */
export async function GET() {
  try {
    const state = await getPauseState();
    const paused = SUBSYSTEMS.flatMap((subsystem) => {
      const e = state.subsystems[subsystem];
      return e?.paused ? [{ subsystem, reason: e.reason, since: e.since }] : [];
    });
    return NextResponse.json({ paused }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } });
  } catch {
    return NextResponse.json({ paused: [], unavailable: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
