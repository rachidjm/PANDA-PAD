import { NextResponse } from "next/server";
import { Connection, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { PANDA_REWARDS_POOL } from "@/lib/pump/constants";

/**
 * The Rewards Pool wallet's real current SOL balance — shared across every
 * coin that has opted into Fee Distribution, so this is a whole-pool number,
 * not any individual holder's or coin's share (see `RewardSource` in
 * `types.ts`). Honestly reports `configured: false` rather than a balance
 * when the pool hasn't been set up yet.
 */
export async function GET() {
  if (!PANDA_REWARDS_POOL) {
    return NextResponse.json({ configured: false });
  }
  try {
    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
    const lamports = await connection.getBalance(PANDA_REWARDS_POOL);
    return NextResponse.json({ configured: true, solBalance: lamports / LAMPORTS_PER_SOL });
  } catch {
    return NextResponse.json({ configured: true, solBalance: null });
  }
}
