import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getTokenMeta } from "@/lib/tokens/meta";

/**
 * Auth: none (public, read-only). Query `mints=<mint>,<mint>,…` (at most 60 valid Solana addresses). Returns `{ tokens: { [mint]: { name?, symbol?,
 * image?, priceUsd?, change24h? } } }` — GeckoTerminal first, Jupiter's token search for what it lacks. The Portfolio calls this instead of the
 * indexers directly, so the browser only talks to PANDA (and PANDA's server caches the answers for a minute).
 */
export async function GET(req: Request) {
  if (await rateLimited(`token-meta:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const mints: string[] = [];
  for (const m of (new URL(req.url).searchParams.get("mints") ?? "").split(",")) {
    const mint = m.trim();
    if (!mint || mints.includes(mint) || mint.length < 32 || mint.length > 44) continue;
    try {
      new PublicKey(mint);
      mints.push(mint);
    } catch {
      // not an address
    }
    if (mints.length >= 60) break;
  }
  if (mints.length === 0) return NextResponse.json({ tokens: {} });
  return NextResponse.json({ tokens: await getTokenMeta(mints) }, { headers: { "Cache-Control": "no-store" } });
}
