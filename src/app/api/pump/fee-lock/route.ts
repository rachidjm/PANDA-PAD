import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { resolvePending } from "@/lib/pump/fee-lock";

/**
 * Is this PANDA-launched coin still waiting for its fee split (PANDA's locked 5%)? Re-reads the chain, so the answer never
 * depends on what a client claims, and lets the registry catch up (a coin whose split is now on-chain leaves it). Public
 * information: the coin page shows the "Set the fee split" notice only to `creator`.
 */
export async function GET(req: Request) {
  if (rateLimited(`fee-lock:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  const mint = new URL(req.url).searchParams.get("mint") ?? "";
  try {
    new PublicKey(mint);
  } catch {
    return NextResponse.json({ error: "Invalid mint." }, { status: 400 });
  }
  try {
    const state = await resolvePending(new Connection(serverRpcUrl(), "confirmed"), mint);
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not check." }, { status: 500 });
  }
}
