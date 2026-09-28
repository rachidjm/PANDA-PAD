import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import { getOnlinePumpSdk } from "@/lib/pump/client";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited } from "@/lib/rate-limit";

/**
 * Read-only price-impact estimate for a trade still on Pump.fun's own bonding curve: how far the average fill
 * price would move from the current spot price, computed straight from the curve's real reserves — the same
 * numbers buy.ts/sell.ts use to build a real transaction, just never signed or sent here.
 *
 * Only meaningful while the coin hasn't graduated (`onCurve: true`). A graduated or migrated coin returns
 * `onCurve: false`; the caller (usePriceImpact.ts) falls back to Jupiter's own quoted `priceImpactPct` instead,
 * the same source BuyPandaWidget.tsx already uses for its own price-impact figure.
 */
export async function GET(req: Request) {
  if (await rateLimited(`pump-impact:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const url = new URL(req.url);
  const side = url.searchParams.get("side") === "sell" ? "sell" : "buy";
  const solAmountParam = url.searchParams.get("solAmount");
  const tokenAmountParam = url.searchParams.get("tokenAmount");
  let mintKey: PublicKey;
  try {
    mintKey = new PublicKey(url.searchParams.get("mint") || "");
  } catch {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  try {
    const connection = new Connection(serverRpcUrl(), "confirmed");
    const online = getOnlinePumpSdk(connection);
    const bondingCurve = await online.fetchBondingCurve(mintKey);
    if (bondingCurve.complete) return NextResponse.json({ onCurve: false }, { headers: { "Cache-Control": "no-store" } });

    const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
    const spot = Number(bondingCurve.virtualQuoteReserves.toString()) / Number(bondingCurve.virtualTokenReserves.toString());
    if (!(spot > 0)) return NextResponse.json({ onCurve: true, impactPct: null, exceedsCurve: false });

    if (side === "buy") {
      const solAmount = Number(solAmountParam);
      if (!Number.isFinite(solAmount) || solAmount <= 0) return NextResponse.json({ error: "Invalid amount." }, { status: 400 });
      const lamports = new BN(Math.round(solAmount * 1e9));
      const tokensOut = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: bondingCurve.tokenTotalSupply, bondingCurve, amount: lamports, quoteMint: bondingCurve.quoteMint });
      if (tokensOut.isZero()) return NextResponse.json({ onCurve: true, impactPct: null, exceedsCurve: false });
      const avg = Number(lamports.toString()) / Number(tokensOut.toString());
      const impactPct = (avg / spot - 1) * 100;
      const exceedsCurve = tokensOut.gt(bondingCurve.realTokenReserves);
      return NextResponse.json({ onCurve: true, impactPct, exceedsCurve }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!tokenAmountParam || !/^\d+$/.test(tokenAmountParam)) return NextResponse.json({ error: "Invalid amount." }, { status: 400 });
    const raw = new BN(tokenAmountParam);
    if (raw.isZero()) return NextResponse.json({ onCurve: true, impactPct: null, exceedsCurve: false });
    const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: bondingCurve.tokenTotalSupply, bondingCurve, amount: raw });
    if (solOut.isZero()) return NextResponse.json({ onCurve: true, impactPct: null, exceedsCurve: false });
    const avg = Number(solOut.toString()) / Number(raw.toString());
    const impactPct = (1 - avg / spot) * 100;
    return NextResponse.json({ onCurve: true, impactPct, exceedsCurve: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to estimate impact." }, { status: 500 });
  }
}
