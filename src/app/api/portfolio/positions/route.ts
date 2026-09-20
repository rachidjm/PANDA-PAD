import { NextResponse } from "next/server";
import { getTrades } from "@/lib/portfolio/trade-log";
import { computePositions } from "@/lib/portfolio/positions";
import { backfillTrades, needsBackfill } from "@/lib/portfolio/backfill";
import { getLiveCoin } from "@/lib/live-coins";
import { usdPrices } from "@/lib/solana/prices";
import { clientIp, rateLimited } from "@/lib/rate-limit";

// The first visit of a wallet scans its on-chain history, which can take a while.
export const maxDuration = 30;

// After a failed history scan (usually the RPC refusing), don't retry on every page load.
const lastBackfillAttempt = new Map<string, number>();
const RETRY_AFTER_MS = 60_000;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** How many of the wallet's latest trades come back as "recent activity". */
const RECENT = 15;

/**
 * Public, read-only: a wallet's positions are derived from its own on-chain history, so anyone can look at
 * any address. Because a first visit scans the chain (costly), the address is validated and requests are rate limited.
 */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (rateLimited(`portfolio:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

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
    const recent = [...trades].sort((a, b) => b.ts - a.ts).slice(0, RECENT);
    return NextResponse.json({ open, closed, recent, historyError });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute positions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
