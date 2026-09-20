/**
 * Integer-only money math. Nothing in here touches floating point: amounts are
 * `bigint` (lamports / base units) and shares are integer basis points, so
 * results are deterministic and identical on every machine.
 */

export const BPS_TOTAL = 10_000;

export class MoneyError extends Error {}

function assertNonNegative(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < BigInt(0)) throw new MoneyError(`${label} must be a non-negative bigint.`);
}

/** floor(amount * bps / 10_000) — the share of `amount` that `bps` basis points represent. */
export function bpsOf(amount: bigint, bps: number): bigint {
  assertNonNegative(amount, "amount");
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > BPS_TOTAL) throw new MoneyError("bps must be an integer in [0, 10000].");
  return (amount * BigInt(bps)) / BigInt(BPS_TOTAL);
}

/**
 * Splits `pool` between recipients in proportion to integer `weights`.
 *
 * Each recipient gets floor(pool * weight / totalWeight); what's left over
 * ("dust", always < number of recipients) is returned explicitly rather than
 * silently vanishing, so the caller must decide where it goes (next epoch,
 * treasury...). Guarantees: sum(allocations) + dust === pool, and
 * sum(allocations) <= pool, for any input.
 */
export function splitPool(pool: bigint, weights: bigint[]): { allocations: bigint[]; dust: bigint } {
  assertNonNegative(pool, "pool");
  weights.forEach((w, i) => assertNonNegative(w, `weights[${i}]`));
  const totalWeight = weights.reduce((sum, w) => sum + w, BigInt(0));
  if (totalWeight === BigInt(0)) return { allocations: weights.map(() => BigInt(0)), dust: pool };

  const allocations = weights.map((w) => (pool * w) / totalWeight);
  const paid = allocations.reduce((sum, a) => sum + a, BigInt(0));
  return { allocations, dust: pool - paid };
}
