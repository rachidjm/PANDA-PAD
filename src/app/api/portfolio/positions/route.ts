import { NextResponse } from "next/server";
import { getTrades } from "@/lib/portfolio/trade-log";
import { computePositions } from "@/lib/portfolio/positions";
import { backfillTrades, needsBackfill } from "@/lib/portfolio/backfill";
import { getLiveCoin } from "@/lib/live-coins";
import { usdPrices } from "@/lib/solana/prices";

// The first visit of a wallet scans its on-chain history, which can take a while.
export const maxDuration = 30;

// After a failed history scan (usually the RPC refusing), don't retry on every page load.
const lastBackfillAttempt = new Map<string, number>();
const RETRY_AFTER_MS = 60_000;

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "Missing wallet." }, { status: 400 });

  try {
    let historyError = false;
    const last = lastBackfillAttempt.get(wallet) || 0;
    if (Date.now() - last > RETRY_AFTER_MS && (await needsBackfill(wallet))) {
      lastBackfillAttempt.set(wallet, Date.now());
      try {
        await backfillTrades(wallet);
      } catch (err) {
        historyError = true;
        console.error("Portfolio history scan failed", err);
      }
    }

    const trades = await getTrades(wallet);
    const mints = [...new Set(trades.map((t) => t.mint))];

    const [prices, metas] = await Promise.all([
      usdPrices(mints),
      Promise.all(
        mints.map(async (m) => {
          const { coin } = await getLiveCoin(m).catch(() => ({ coin: undefined }));
          return [m.toLowerCase(), coin ? { image: coin.image, doodle: coin.doodle, bg: coin.bg, priceHistory: coin.priceHistory } : {}] as const;
        })
      ),
    ]);

    const priceByMint = Object.fromEntries([...prices].map(([m, p]) => [m.toLowerCase(), p]));
    const { open, closed } = computePositions(trades, priceByMint, Object.fromEntries(metas));
    return NextResponse.json({ open, closed, historyError });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute positions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
