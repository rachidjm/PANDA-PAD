import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildBuyTransaction } from "@/lib/pump/buy";

export async function POST(req: Request) {
  // Building a trade costs real RPC calls: cap it per visitor so nobody can burn the RPC budget everyone else trades with.
  if (rateLimited(`trade-build:${clientIp(req)}`, 40, 60_000)) return NextResponse.json({ error: "Too many requests — wait a moment and try again." }, { status: 429 });
  try {
    const { mint, user, solAmount, poolAddress, slippagePct } = await req.json();
    if (!mint || !user || !solAmount) {
      return NextResponse.json({ error: "Missing mint, user or solAmount." }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const userKey = new PublicKey(user);

    const tx = await buildBuyTransaction({
      connection,
      mint: new PublicKey(mint),
      user: userKey,
      solAmount: Number(solAmount),
      poolAddress: poolAddress ? new PublicKey(poolAddress) : undefined,
      slippagePct: slippagePct ? Number(slippagePct) : undefined,
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = userKey;
    tx.recentBlockhash = blockhash;

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return NextResponse.json({ transaction: serialized.toString("base64") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
