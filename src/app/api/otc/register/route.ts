import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit/log";
import { registerCoin } from "@/lib/otc/client";
import { getOtcLaunch, patchOtcLaunch } from "@/lib/otc/store";
import { otcRewardAssetByMint } from "@/lib/otc/reward-assets";

/**
 * Step 3 (optional) of a PANDA Rewards launch: POST /api/coins, so the coin appears on OTC's own
 * board. Per the docs, the coin already exists and earns fees without this the moment TX2 confirms —
 * this only affects listing. A 409 means OTC hasn't indexed the signature yet: the docs say to wait
 * and retry, never to relaunch, so that's exactly what this returns to the client (still 409, with a
 * flag the client polls on) rather than treating it as a hard failure.
 */
export async function POST(req: Request) {
  const disabled = featureDisabledResponse("OTC_REWARDS");
  if (disabled) return disabled;
  {
    // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
    const limited = await moneyRateGate(`otc-register:${clientIp(req)}`, 20, 60_000, () => NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 }));
    if (limited) return limited;
  }
  try {
    const { mint } = await req.json();
    if (typeof mint !== "string" || !mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });

    const record = await getOtcLaunch(mint);
    if (!record) return NextResponse.json({ error: "No launch found for this mint." }, { status: 404 });
    if (record.status !== "CONFIRMED" || !record.tx2Signature || !record.config) {
      return NextResponse.json({ error: `This launch is at "${record.status}" — both transactions must confirm first.` }, { status: 409 });
    }
    if (record.registered) return NextResponse.json({ launch: record });

    const asset = otcRewardAssetByMint(record.quoteMint);
    if (!asset) return NextResponse.json({ error: "Reward asset is no longer recognized." }, { status: 400 });

    const result = await registerCoin({
      mint: record.mint,
      name: record.name,
      symbol: record.symbol,
      uri: record.uri,
      creator: record.creator,
      createTx: record.tx2Signature,
      pairMint: asset.mint,
      pairSymbol: asset.symbol,
      rewardMint: asset.mint,
      rewardSymbol: asset.symbol,
      meteoraConfig: record.config,
    });

    if (!result.ok && result.notIndexedYet) {
      return NextResponse.json({ error: "OTC hasn't indexed this transaction yet — wait a moment and try again.", code: "NOT_INDEXED_YET" }, { status: 409 });
    }
    if (!result.ok) {
      await patchOtcLaunch(mint, { registerError: result.error }, Date.now());
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    const updated = await patchOtcLaunch(mint, { registered: true, registerError: undefined }, Date.now());
    await recordAudit({ req, actor: `unauthenticated:${record.creator}`, action: "otc.coin_registered", object: mint });
    return NextResponse.json({ launch: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register coin.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
