import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getRugSummaries } from "@/lib/rugcheck/server";

/**
 * Auth: none (public, read-only). Query: `mints=<mint>,<mint>,…` (at most 30 valid Solana addresses; anything else is ignored).
 * Returns `{ results: { [mint]: { level, score, risks, lpLockedPct } }, pending: [mint…] }`: RugCheck's summary for the coins it has (cached
 * 10 minutes in Upstash), and the coins still waiting for a turn within RugCheck's rate limit. A coin RugCheck can't or won't rate is in
 * neither list: the UI shows nothing for it. The browser never talks to RugCheck; only this route does, sending nothing but the mint address.
 */
export async function GET(req: Request) {
  if (await rateLimited(`rugcheck:${clientIp(req)}`, 90, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const raw = new URL(req.url).searchParams.get("mints") ?? "";
  const mints: string[] = [];
  for (const m of raw.split(",")) {
    const mint = m.trim();
    if (!mint || mints.includes(mint) || mint.length < 32 || mint.length > 44) continue;
    try {
      new PublicKey(mint);
      mints.push(mint);
    } catch {
      // not an address
    }
    if (mints.length >= 30) break;
  }
  if (mints.length === 0) return NextResponse.json({ results: {}, pending: [] });
  const batch = await getRugSummaries(mints);
  return NextResponse.json(batch, { headers: { "Cache-Control": "no-store" } });
}
