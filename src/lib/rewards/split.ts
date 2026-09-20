import { splitPool } from "@/lib/money/bps";

/**
 * Splits `distributedLamports` between token holders in proportion to their
 * raw (integer) balances — no floating point anywhere. A wallet holding
 * several token accounts is merged first. Returns each wallet's credit plus
 * the rounding remainder ("dust", less than one lamport per holder), which the
 * ledger records explicitly so credits + dust always equal what was distributed.
 */
export function computeHolderCredits(
  holders: { address: string; amount: bigint }[],
  distributedLamports: number
): { credits: { address: string; lamports: number }[]; dust: number } {
  if (!Number.isSafeInteger(distributedLamports) || distributedLamports < 0) {
    throw new Error("distributedLamports must be a non-negative safe integer.");
  }

  const merged = new Map<string, bigint>();
  for (const h of holders) {
    if (h.amount <= BigInt(0)) continue;
    merged.set(h.address, (merged.get(h.address) ?? BigInt(0)) + h.amount);
  }
  const entries = [...merged.entries()];

  const { allocations, dust } = splitPool(BigInt(distributedLamports), entries.map(([, amount]) => amount));
  return {
    credits: entries.map(([address], i) => ({ address, lamports: Number(allocations[i]) })).filter((c) => c.lamports > 0),
    dust: Number(dust),
  };
}
