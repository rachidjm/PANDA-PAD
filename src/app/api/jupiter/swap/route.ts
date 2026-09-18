import { NextResponse } from "next/server";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { buildJupiterSwapTransaction } from "@/lib/jupiter/swap";

export async function POST(req: Request) {
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

    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");

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
