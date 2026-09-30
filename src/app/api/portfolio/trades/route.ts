import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getTrades } from "@/lib/portfolio/trade-log";
import { backfillTrades, needsBackfill } from "@/lib/portfolio/backfill";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// A first-time scan of a wallet's on-chain history can take a while (see backfill.ts's own TIME_BUDGET_MS).
export const maxDuration = 30;

// After a failed history scan (usually the RPC refusing), don't retry on every chart load — same guard
// Portfolio's own /api/portfolio/positions route uses; both ultimately write to the same wallet-level trade
// log (trade-log.ts), so whichever page the wallet visits first does the real scan for both.
const lastBackfillAttempt = new Map<string, number>();
const RETRY_AFTER_MS = 60_000;

/**
 * Public, read-only: every trade this wallet has ever made on this one coin — PANDA's own recorded trades AND
 * real on-chain history from outside PANDA too, via the same backfill /portfolio uses (not the whole wallet's
 * log across every coin — see /api/portfolio/positions for that). Oldest first. Used to mark a wallet's own
 * buys/sells on the coin page's chart (src/components/coin/TradeMarkers.tsx), on ANY coin, not just ones
 * traded through PANDA.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const mint = url.searchParams.get("mint");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (!mint || !ADDRESS.test(mint)) return NextResponse.json({ error: "Missing or invalid mint." }, { status: 400 });
  if (await rateLimited(`portfolio-trades:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const last = lastBackfillAttempt.get(wallet) || 0;
    if (Date.now() - last > RETRY_AFTER_MS && (await needsBackfill(wallet))) {
      lastBackfillAttempt.set(wallet, Date.now());
      try {
        await backfillTrades(wallet);
      } catch (err) {
        console.error("Coin-page trade history scan failed", err);
      }
    }

    const all = await getTrades(wallet);
    const trades = all.filter((t) => t.mint === mint).sort((a, b) => a.ts - b.ts);
    return NextResponse.json({ trades }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read trades.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
