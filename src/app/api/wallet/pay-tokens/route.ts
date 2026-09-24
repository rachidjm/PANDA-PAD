import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { getPayTokens } from "@/lib/trading/pay-tokens";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The tokens a wallet holds that it could pay a buy with (has a live market, not dust). Public and read-only — what a
 * wallet holds is public on-chain — so it only validates the address and rate limits, since it costs RPC and price lookups.
 */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`pay-tokens:${clientIp(req)}`, 20, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const tokens = await getPayTokens(new Connection(serverRpcUrl(), "confirmed"), new PublicKey(wallet));
    return NextResponse.json({ tokens });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the wallet's tokens." }, { status: 502 });
  }
}
