import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getSessionWallet } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";
import { getEpochs } from "@/lib/points/store";
import { getWalletAllocation, readClaim } from "@/lib/airdrop/store";

/**
 * Auth: signed-in wallet session; a wallet only ever sees its own allocation.
 * Output, per published epoch (latest 5): the amount (PANDA base units, decimal string),
 * its Merkle proof (so it can be checked against the public root), and the claim
 * status. "Estimated" figures are never shown here — only what has been published.
 * Gated by PANDA_AIRDROPS.
 */
export async function GET(req: Request) {
  if (!isEnabled("PANDA_AIRDROPS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const wallet = getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (await rateLimited(`airdrop-me:${wallet}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const published = (await getEpochs()).filter((e) => e.merkleRoot && ["DISTRIBUTING", "COMPLETED", "PAUSED"].includes(e.status)).slice(-5);
    const airdrops = await Promise.all(
      published.map(async (e) => {
        const alloc = await getWalletAllocation(e, wallet);
        if (alloc === "integrity") return { epoch: e.id, status: e.status, verified: false as const };
        if (!alloc) return { epoch: e.id, status: e.status, verified: true as const, eligible: false as const };
        const claim = await readClaim(e.id, wallet);
        return {
          epoch: e.id,
          status: e.status,
          verified: true as const,
          eligible: true as const,
          amount: alloc.amount.toString(),
          merkleRoot: e.merkleRoot,
          leafCount: e.airdropLeafCount,
          leafIndex: alloc.index,
          proof: alloc.proof,
          claim: claim ? { status: claim.status, signature: claim.signature ?? null, attempts: claim.attempts } : { status: "ELIGIBLE" as const, signature: null, attempts: 0 },
        };
      })
    );
    const res = NextResponse.json({ wallet, airdrops });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't load your airdrops." }, { status: 500 });
  }
}
