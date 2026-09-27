import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getTrades } from "@/lib/portfolio/trade-log";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Public, read-only: every trade PANDA has recorded for this wallet on this one coin (not the whole wallet's
 * log — see /api/portfolio/positions for that), oldest first. Used to mark a wallet's own buys/sells on the
 * coin page's chart (src/components/coin/TradeMarkers.tsx).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const mint = url.searchParams.get("mint");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (!mint || !ADDRESS.test(mint)) return NextResponse.json({ error: "Missing or invalid mint." }, { status: 400 });
  if (await rateLimited(`portfolio-trades:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const all = await getTrades(wallet);
    const trades = all.filter((t) => t.mint === mint).sort((a, b) => a.ts - b.ts);
    return NextResponse.json({ trades }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read trades.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
