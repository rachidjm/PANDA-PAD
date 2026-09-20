import { docListPaths, docPutOnce, docRead, docUpdate } from "@/lib/storage/store";
import type { Epoch } from "@/lib/epochs/epoch";
import { getEpochs, getTotals, transitionEpoch } from "@/lib/points/store";
import { AllocationSet, allocationIsIntact, computeAllocations } from "./allocate";
import { buildTree, leafHash, MerkleTree, ProofStep, proofFor } from "./merkle";
import { ClaimRecord } from "./claim-machine";

/**
 * Storage and verification for published airdrops (server only). The allocation
 * set of an epoch is written ONCE and never overwritten; before any payout it
 * is re-verified end to end against what the epoch pinned (allocation hash,
 * Merkle root, leaf count). Anything that doesn't verify is treated as
 * "integrity failure" and halts claims — it is never trusted or repaired silently.
 */

const allocationPath = (epoch: number) => `airdrop/allocations/${epoch}.json`;
const claimPath = (epoch: number, wallet: string) => `airdrop/claims/${epoch}/${wallet}.json`;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function treeFor(set: AllocationSet): MerkleTree {
  return buildTree(set.entries.map((e) => leafHash(set.epoch, e.wallet, e.amount)));
}

/**
 * What a published epoch still owes: its distributed total minus what is already
 * CLAIMED (finalized). Anything not yet claimed is still an obligation of the pool.
 * Throws if the epoch's data doesn't verify — callers must then refuse.
 */
export async function outstandingBaseUnits(epoch: Epoch): Promise<bigint> {
  const loaded = await loadVerifiedAllocation(epoch);
  if (loaded === null || loaded === "integrity") throw new Error(`Epoch ${epoch.id}'s airdrop data failed verification.`);
  let claimed = BigInt(0);
  for (const path of await docListPaths(`airdrop/claims/${epoch.id}/`)) {
    const rec = await docRead<ClaimRecord | null>(path, null);
    if (rec?.status === "CLAIMED") claimed += BigInt(rec.amount);
  }
  return BigInt(loaded.set.distributed) - claimed;
}

export type PublishResult =
  | { ok: true; epoch: Epoch; allocation: AllocationSet; merkleRoot: string }
  | { ok: false; error: string };

/**
 * FINALIZED -> DISTRIBUTING. Builds the allocation from the epoch's PINNED totals,
 * the Merkle tree over it, stores the set once, and pins root + hash on the epoch.
 * `checkFunded` must confirm the airdrop pool actually holds the tokens: publishing
 * an unfunded airdrop would promise users money that can't be paid.
 */
export async function publishAirdrop(
  epochId: number,
  now: number,
  checkFunded: (pool: bigint) => Promise<string | null>
): Promise<PublishResult> {
  const epoch = (await getEpochs()).find((e) => e.id === epochId);
  if (!epoch) return { ok: false, error: "No such epoch." };
  if (epoch.status !== "FINALIZED") return { ok: false, error: `Epoch is ${epoch.status}, not FINALIZED.` };

  const totals = await getTotals(epochId);
  if (!totals || totals.hash !== epoch.totalsHash) return { ok: false, error: "The epoch's points totals are missing or don't match the pinned hash." };

  let allocation: AllocationSet;
  try {
    allocation = computeAllocations(totals, BigInt(epoch.rewardPool));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't compute allocations." };
  }

  // The pool must cover this epoch AND everything earlier published epochs still owe (they share one pool wallet).
  const others = (await getEpochs()).filter(
    (e) => e.id !== epochId && e.merkleRoot && (e.status === "DISTRIBUTING" || (e.status === "PAUSED" && e.pausedFrom === "DISTRIBUTING"))
  );
  let owed = BigInt(allocation.distributed);
  try {
    for (const other of others) owed += await outstandingBaseUnits(other);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't verify earlier airdrops." };
  }
  const fundingProblem = await checkFunded(owed);
  if (fundingProblem) return { ok: false, error: fundingProblem };

  const tree = treeFor(allocation);
  if (!(await docPutOnce(allocationPath(epochId), allocation))) {
    const existing = await docRead<AllocationSet | null>(allocationPath(epochId), null);
    if (!existing || !allocationIsIntact(existing) || existing.allocationHash !== allocation.allocationHash) {
      return { ok: false, error: "An allocation set already exists and differs from a fresh calculation — refusing to overwrite. Investigate." };
    }
  }

  const moved = await transitionEpoch(epochId, "DISTRIBUTING", now, {
    merkleRoot: tree.root,
    allocationHash: allocation.allocationHash,
    airdropLeafCount: tree.count,
    airdropPublishedAt: now,
  });
  if (!moved.ok) return moved;
  return { ok: true, epoch: moved.after, allocation, merkleRoot: tree.root };
}

/** Reads and fully verifies an epoch's stored allocation. Null if there is none; "integrity" if it doesn't verify. */
export async function loadVerifiedAllocation(epoch: Epoch): Promise<{ set: AllocationSet; tree: MerkleTree } | null | "integrity"> {
  if (!epoch.merkleRoot || !epoch.allocationHash) return null;
  const set = await docRead<AllocationSet | null>(allocationPath(epoch.id), null);
  if (!set) return "integrity"; // it was published, so it must exist
  if (!allocationIsIntact(set) || set.allocationHash !== epoch.allocationHash || set.epoch !== epoch.id) return "integrity";
  const tree = treeFor(set);
  if (tree.root !== epoch.merkleRoot || tree.count !== epoch.airdropLeafCount) return "integrity";
  return { set, tree };
}

export type WalletAllocation = { amount: bigint; index: number; proof: ProofStep[] };

/** A wallet's verified allocation with its Merkle proof; null if it has none; "integrity" if the data doesn't verify. */
export async function getWalletAllocation(epoch: Epoch, wallet: string): Promise<WalletAllocation | null | "integrity"> {
  const loaded = await loadVerifiedAllocation(epoch);
  if (loaded === null || loaded === "integrity") return loaded;
  const index = loaded.set.entries.findIndex((e) => e.wallet === wallet);
  if (index === -1) return null;
  return { amount: BigInt(loaded.set.entries[index].amount), index, proof: proofFor(loaded.tree, index) };
}

export async function readClaim(epoch: number, wallet: string): Promise<ClaimRecord | null> {
  if (!SOLANA_ADDRESS.test(wallet)) return null;
  return docRead<ClaimRecord | null>(claimPath(epoch, wallet), null);
}

export async function updateClaim<R>(
  epoch: number,
  wallet: string,
  mutate: (rec: ClaimRecord | null) => { next: ClaimRecord | null; result: R }
): Promise<R> {
  if (!SOLANA_ADDRESS.test(wallet)) throw new Error("Invalid wallet.");
  return docUpdate<ClaimRecord | null, R>(claimPath(epoch, wallet), null, mutate);
}
