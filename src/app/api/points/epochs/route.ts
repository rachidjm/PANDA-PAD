import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getEpochs } from "@/lib/points/store";
import { POINTS_CONFIG } from "@/lib/points/config";

/**
 * Auth: none (public). Output: { epochs: [...] } — timing, status, formula
 * version and pinned totals hash only; never any wallet's data.
 * Gated by the PANDA_POINTS feature flag (off unless enabled).
 */
export async function GET() {
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  try {
    const epochs = await getEpochs();
    return NextResponse.json(
      {
        epochs: epochs.map((e) => ({
          id: e.id,
          status: e.status,
          startTime: e.startTime,
          snapshotTime: e.snapshotTime,
          endTime: e.endTime,
          rewardPool: e.rewardPool,
          formulaVersion: e.formulaVersion,
          totalsHash: e.totalsHash ?? null,
          airdropPublished: Boolean(e.merkleRoot),
        })),
        // The published rules, so the page can show the real numbers (never a hand-written copy).
        rules: {
          formulaVersion: POINTS_CONFIG.version,
          trade: POINTS_CONFIG.trade,
          caps: POINTS_CONFIG.caps,
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't load epochs." }, { status: 500 });
  }
}
