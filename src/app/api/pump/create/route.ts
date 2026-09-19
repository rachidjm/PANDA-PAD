import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildCreateTransaction } from "@/lib/pump/create";
import { validateShareholders, FeeShareholderInput } from "@/lib/pump/fee-shares-validation";

export async function POST(req: Request) {
  if (rateLimited(`pump-create:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  try {
    const { mint, user, name, symbol, uri, shareholders } = await req.json();
    if (!mint || !user || !name || !symbol || !uri) {
      return NextResponse.json({ error: "Missing mint, user, name, symbol or uri." }, { status: 400 });
    }

    // Fee Distribution is optional — only validate it if the creator actually set it up.
    // Never trust the client's own 100% check alone.
    if (shareholders !== undefined) {
      if (!Array.isArray(shareholders)) {
        return NextResponse.json({ error: "Invalid shareholders." }, { status: 400 });
      }
      const validationError = validateShareholders(shareholders as FeeShareholderInput[]);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const userKey = new PublicKey(user);

    const tx = await buildCreateTransaction({
      mint: new PublicKey(mint),
      user: userKey,
      name: String(name),
      symbol: String(symbol),
      uri: String(uri),
      shareholders: shareholders?.length ? shareholders : undefined,
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
