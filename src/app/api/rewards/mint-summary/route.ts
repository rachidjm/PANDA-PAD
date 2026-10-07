import { NextResponse } from "next/server";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgHolderRewardsPaidForMint, pgLastPayoutRun, pgPayoutRunClaims } from "@/lib/db/rewards";
import { PublicKey } from "@solana/web3.js";

/** Public, read-only: one coin's own "Recompensas" tab — what has actually been paid to its holders so far,
 *  and the most recent automatic payout round (src/lib/rewards/run-payout.ts), with a signature to check on
 *  Solscan. Nothing here is a promise about what a coin will pay in the future — only what already happened,
 *  verified on-chain by the cron that sent it. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  try {
    if (!mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });
    new PublicKey(mint);
  } catch {
    return NextResponse.json({ error: "Invalid mint." }, { status: 400 });
  }

  try {
    const db = getDb();
    const [paidTotalLamports, lastRun] = await Promise.all([pgHolderRewardsPaidForMint(db, mint), pgLastPayoutRun(db, mint)]);
    let lastSignature: string | null = null;
    if (lastRun && lastRun.status === "done" && lastRun.holdersPaid > 0) {
      const claims = await pgPayoutRunClaims(db, lastRun.id);
      lastSignature = claims.find((c) => c.signature)?.signature ?? null;
    }
    return NextResponse.json(
      { paidTotalLamports, lastRun: lastRun ? { finishedAt: lastRun.finishedAt, status: lastRun.status, holdersPaid: lastRun.holdersPaid, lamportsPaid: lastRun.lamportsPaid } : null, lastSignature },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ paidTotalLamports: 0, lastRun: null, lastSignature: null });
    return NextResponse.json({ error: "Couldn't read this coin's rewards summary right now." }, { status: 500 });
  }
}
