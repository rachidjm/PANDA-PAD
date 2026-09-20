import { createHash } from "node:crypto";
import { splitPool } from "@/lib/money/bps";
import { EpochTotals, totalsAreIntact } from "@/lib/epochs/totals";

/**
 * Turns an epoch's pinned points totals into airdrop amounts. Pure, integer
 * only (bigint base units): each wallet gets floor(pool * points / totalPoints).
 * The rounding remainder ("dust", less than one base unit per recipient) is
 * NOT distributed and NOT lost: it is returned explicitly and recorded, and by
 * policy carries forward — the admin adds it to the next epoch's reward pool.
 *
 * Guarantees, for any input: sum(amounts) + dust == pool, sum(amounts) <= pool,
 * every amount > 0, one entry per wallet, entries sorted by wallet.
 */

export const AIRDROP_DUST_POLICY = "carry_forward" as const;

export type AllocationEntry = { wallet: string; points: number; amount: string };

export type AllocationSet = {
  epoch: number;
  formulaVersion: string;
  /** The finalized points totals this was computed from. */
  totalsHash: string;
  /** Airdrop pool, PANDA base units, decimal string. */
  pool: string;
  distributed: string;
  dust: string;
  dustPolicy: typeof AIRDROP_DUST_POLICY;
  entries: AllocationEntry[];
  /** sha256 over the canonical form of the above — what the epoch pins. */
  allocationHash: string;
};

export function canonicalAllocationBody(a: Omit<AllocationSet, "allocationHash">): string {
  return JSON.stringify({
    epoch: a.epoch,
    formulaVersion: a.formulaVersion,
    totalsHash: a.totalsHash,
    pool: a.pool,
    distributed: a.distributed,
    dust: a.dust,
    dustPolicy: a.dustPolicy,
    entries: a.entries.map((e) => [e.wallet, e.points, e.amount]),
  });
}

export const hashAllocation = (a: Omit<AllocationSet, "allocationHash">) =>
  createHash("sha256").update(canonicalAllocationBody(a)).digest("hex");

export function computeAllocations(totals: EpochTotals, pool: bigint): AllocationSet {
  if (!totalsAreIntact(totals)) throw new Error("Points totals fail their integrity check — refusing to allocate.");
  if (typeof pool !== "bigint" || pool < BigInt(0)) throw new Error("Pool must be a non-negative bigint.");
  if (totals.entries.length === 0 || totals.totalPoints <= 0) throw new Error("No points were earned in this epoch — nothing to allocate.");

  const sorted = [...totals.entries].sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  if (new Set(sorted.map((e) => e.wallet)).size !== sorted.length) throw new Error("Duplicate wallet in totals.");

  const { allocations, dust } = splitPool(pool, sorted.map((e) => BigInt(e.points)));
  const entries: AllocationEntry[] = [];
  sorted.forEach((e, i) => {
    if (allocations[i] > BigInt(0)) entries.push({ wallet: e.wallet, points: e.points, amount: allocations[i].toString() });
  });

  const distributed = allocations.reduce((s, a) => s + a, BigInt(0));
  if (distributed + dust !== pool || distributed > pool) throw new Error("Allocation invariant violated (sum + dust != pool).");

  const body = {
    epoch: totals.epoch,
    formulaVersion: totals.formulaVersion,
    totalsHash: totals.hash,
    pool: pool.toString(),
    distributed: distributed.toString(),
    dust: dust.toString(),
    dustPolicy: AIRDROP_DUST_POLICY,
    entries,
  };
  return { ...body, allocationHash: hashAllocation(body) };
}

/** Re-checks a stored allocation set end to end: hash, sums and shape. Used before trusting it for any payout. */
export function allocationIsIntact(a: AllocationSet): boolean {
  try {
    const { allocationHash, ...body } = a;
    if (hashAllocation(body) !== allocationHash) return false;
    const sum = a.entries.reduce((s, e) => s + BigInt(e.amount), BigInt(0));
    if (sum !== BigInt(a.distributed)) return false;
    if (sum + BigInt(a.dust) !== BigInt(a.pool)) return false;
    if (a.entries.some((e) => !/^\d+$/.test(e.amount) || BigInt(e.amount) <= BigInt(0))) return false;
    return new Set(a.entries.map((e) => e.wallet)).size === a.entries.length;
  } catch {
    return false;
  }
}
