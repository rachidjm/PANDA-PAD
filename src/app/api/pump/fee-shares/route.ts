import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { getFeeSharingConfig } from "@/lib/pump/fee-sharing";

/**
 * Reads a coin's real on-chain Fee Distribution back — `{shareholders: null}`
 * if it never opted in. Setting Fee Distribution up in the first place
 * happens as part of coin creation (see /api/pump/create and
 * src/lib/pump/create.ts), bundled into the same transaction as the coin
 * itself, so there's no separate write endpoint here.
 */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  if (!mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });
  try {
    const connection = new Connection(serverRpcUrl(), "confirmed");
    const shareholders = await getFeeSharingConfig(connection, new PublicKey(mint));
    return NextResponse.json({ shareholders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read fee-distribution config.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
