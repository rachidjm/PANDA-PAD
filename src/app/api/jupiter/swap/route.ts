import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildJupiterSwapTransaction } from "@/lib/jupiter/swap";

export async function POST(req: Request) {
  // Building a trade costs real RPC calls: cap it per visitor so nobody can burn the RPC budget everyone else trades with.
  if (rateLimited(`trade-build:${clientIp(req)}`, 40, 60_000)) return NextResponse.json({ error: "Too many requests — wait a moment and try again." }, { status: 429 });
  try {
    const { mint, user, side, solAmount, tokenAmount, slippagePct } = await req.json();
    if (!mint || !user || (side !== "buy" && side !== "sell")) {
      return NextResponse.json({ error: "Missing mint, user or side." }, { status: 400 });
    }
    if (side === "buy" && !solAmount) {
      return NextResponse.json({ error: "Missing solAmount." }, { status: 400 });
    }
    if (side === "sell" && !tokenAmount) {
      return NextResponse.json({ error: "Missing tokenAmount." }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");

    const tx = await buildJupiterSwapTransaction({
      connection,
      mint: new PublicKey(mint),
      user: new PublicKey(user),
      side,
      solAmount: solAmount ? Number(solAmount) : undefined,
      tokenAmount: tokenAmount ? String(tokenAmount) : undefined,
      slippagePct: slippagePct ? Number(slippagePct) : undefined,
    });

    const serialized = tx.serialize();
    return NextResponse.json({ transaction: Buffer.from(serialized).toString("base64") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
