import { NextResponse } from "next/server";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { buildFeeSharingTransaction, getFeeSharingConfig } from "@/lib/pump/fee-sharing";
import { validateShareholders, FeeShareholderInput } from "@/lib/pump/fee-shares-validation";

/** Reads a coin's real on-chain Fee Distribution back — `{shareholders: null}` if it never opted in. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  if (!mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });
  try {
    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
    const shareholders = await getFeeSharingConfig(connection, new PublicKey(mint));
    return NextResponse.json({ shareholders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read fee-distribution config.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { mint, creator, shareholders } = await req.json();
    if (!mint || !creator || !Array.isArray(shareholders)) {
      return NextResponse.json({ error: "Missing mint, creator or shareholders." }, { status: 400 });
    }

    // Never trust the client's own 100% check — the on-chain program enforces
    // it too, but validating here gives a clear error before we even build a
    // transaction.
    const validationError = validateShareholders(shareholders as FeeShareholderInput[]);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
    const creatorKey = new PublicKey(creator);

    const tx = await buildFeeSharingTransaction({
      mint: new PublicKey(mint),
      creator: creatorKey,
      shareholders,
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = creatorKey;
    tx.recentBlockhash = blockhash;

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return NextResponse.json({ transaction: serialized.toString("base64") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build the fee-sharing transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
