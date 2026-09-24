import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { strategyQuote } from "@/lib/strategy/market";

/**
 * The real, current numbers the "Draw Your Trade" screen converts with: token price, SOL, USDC and EUR→USD, plus
 * the pool's liquidity. Each is a live quote or null; `engine` says whether order execution is configured here.
 */
export async function GET(req: Request) {
  if (await rateLimited(`strategy-quote:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const mint = new URL(req.url).searchParams.get("mint") || "";
  try {
    new PublicKey(mint);
  } catch {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }
  const quote = await strategyQuote(mint);
  return NextResponse.json({ ...quote, engine: !!process.env.JUPITER_API_KEY }, { headers: { "Cache-Control": "no-store" } });
}
