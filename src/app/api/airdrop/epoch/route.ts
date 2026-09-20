import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getEpochs } from "@/lib/points/store";
import { loadVerifiedAllocation } from "@/lib/airdrop/store";

/**
 * Auth: none (public transparency). Query: ?id=<epoch>. Output: everything needed to
 * audit an epoch's airdrop without any wallet's data — pool, distributed, dust and
 * its policy, recipient count, and the three pinned hashes (points totals,
 * allocation set, Merkle root), plus the formula. If the stored data doesn't
 * verify against what the epoch pinned, says so instead of serving it.
 * Gated by PANDA_AIRDROPS.
 */
export async function GET(req: Request) {
  if (!isEnabled("PANDA_AIRDROPS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid epoch." }, { status: 400 });
  try {
    const epoch = (await getEpochs()).find((e) => e.id === id);
    if (!epoch || !epoch.merkleRoot) return NextResponse.json({ error: "No published airdrop for this epoch." }, { status: 404 });
    const loaded = await loadVerifiedAllocation(epoch);
    if (loaded === null || loaded === "integrity") {
      return NextResponse.json({ error: "This airdrop's data failed verification — claims are halted.", verified: false }, { status: 503 });
    }
    const { set } = loaded;
    return NextResponse.json(
      {
        epoch: epoch.id,
        status: epoch.status,
        verified: true,
        pool: set.pool,
        distributed: set.distributed,
        dust: set.dust,
        dustPolicy: set.dustPolicy,
        recipients: set.entries.length,
        formula: "amount = floor(pool x wallet points / total points)",
        formulaVersion: set.formulaVersion,
        totalsHash: set.totalsHash,
        allocationHash: set.allocationHash,
        merkleRoot: epoch.merkleRoot,
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't load this airdrop." }, { status: 500 });
  }
}
