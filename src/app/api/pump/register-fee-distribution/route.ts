import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getFeeSharingConfig } from "@/lib/pump/fee-sharing";
import { registerMint } from "@/lib/rewards/registry";

/**
 * Adds a mint to PANDA's own registry of coins the rewards distributor
 * should process — but only after re-verifying the real on-chain
 * `SharingConfig` actually exists, never trusting the client's say-so alone
 * (the same discipline every other write path in this app follows).
 */
export async function POST(req: Request) {
  if (rateLimited(`register-fee:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  try {
    const { mint } = await req.json();
    if (!mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });

    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
    const shareholders = await getFeeSharingConfig(connection, new PublicKey(mint));
    if (!shareholders) {
      return NextResponse.json({ error: "No real on-chain fee-sharing config found for this mint." }, { status: 400 });
    }

    await registerMint(mint);
    return NextResponse.json({ registered: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
