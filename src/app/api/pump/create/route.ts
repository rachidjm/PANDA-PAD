import { NextResponse } from "next/server";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { buildCreateTransaction } from "@/lib/pump/create";

export async function POST(req: Request) {
  try {
    const { mint, user, name, symbol, uri } = await req.json();
    if (!mint || !user || !name || !symbol || !uri) {
      return NextResponse.json({ error: "Missing mint, user, name, symbol or uri." }, { status: 400 });
    }

    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
    const userKey = new PublicKey(user);

    const tx = await buildCreateTransaction({
      mint: new PublicKey(mint),
      user: userKey,
      name: String(name),
      symbol: String(symbol),
      uri: String(uri),
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
