import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { feeBpsForWallet } from "@/lib/pump/fee-tier";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Public, read-only: the trading-fee rate (bps) that actually applies to this wallet right now — the same
 *  per-wallet lookup buy.ts/sell.ts/amm-trade.ts/jupiter/swap.ts use when building a real trade. Lets the UI
 *  show the real commission instead of the static default. */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`fee-bps:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const feeBps = await feeBpsForWallet(wallet);
  return NextResponse.json({ feeBps }, { headers: { "Cache-Control": "no-store" } });
}
