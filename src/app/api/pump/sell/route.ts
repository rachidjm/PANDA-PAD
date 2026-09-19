import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { buildSellTransaction } from "@/lib/pump/sell";

export async function POST(req: Request) {
  try {
    const { mint, user, tokenAmount, poolAddress, slippagePct } = await req.json();
    if (!mint || !user || !tokenAmount) {
      return NextResponse.json({ error: "Missing mint, user or tokenAmount." }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const userKey = new PublicKey(user);

    const tx = await buildSellTransaction({
      connection,
      mint: new PublicKey(mint),
      user: userKey,
      tokenAmount: new BN(String(tokenAmount)),
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
