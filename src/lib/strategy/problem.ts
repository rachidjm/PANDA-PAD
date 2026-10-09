/**
 * Draw Your Trade shows ONE short message next to the confirm button — never a list under each line. This picks which
 * one: the problem the user must fix first, in plain terms. Pure, so the priority is tested.
 */

/** Most urgent first: what makes everything else moot (over 100%, no coin, no price) before a single line's price. */
export const PROBLEM_PRIORITY = [
  "over_100",
  "no_balance",
  "price_unavailable",
  "sell_not_above_current",
  "stop_not_below_current",
  "tp_not_above_stop",
  "sell_too_close",
  "stop_too_close",
  "buy_too_close",
  "below_minimum",
  "too_far",
  "liquidity_unknown",
  "liquidity_low",
  "too_large_for_pool",
  "invalid_price",
] as const;

/** The first problem among every line's issues (plus "over_100" when the lines add up to more than the balance). */
export function firstProblem(issues: readonly string[], allocatedPct = 0): string | null {
  const all = new Set(issues);
  if (allocatedPct > 100.0001) all.add("over_100");
  for (const p of PROBLEM_PRIORITY) if (all.has(p)) return p;
  return all.size ? [...all][0] : null;
}

/** "Firmar 2 órdenes": every sell and every stop is its own order. */
export function orderCount(tranches: readonly { sell?: number; stop?: number }[]): number {
  return tranches.reduce((n, t) => n + (t.sell !== undefined ? 1 : 0) + (t.stop !== undefined ? 1 : 0), 0);
}
