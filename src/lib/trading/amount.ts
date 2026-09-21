/**
 * Typing what to spend in the currency you think in. A buy is always paid in SOL on-chain, so a figure typed in
 * dollars or euros is converted to SOL with the real, current rates before anything is built or signed, and the
 * screen shows both. A missing rate means that unit can't be used (`null`) — never a guessed one.
 */

export type BuyUnit = "SOL" | "USD" | "EUR";
export type BuyRates = { solUsd: number | null; eurUsd: number | null };

export const BUY_PRESETS: Record<BuyUnit, number[]> = { SOL: [0.1, 0.5, 1], USD: [10, 25, 50], EUR: [10, 25, 50] };

const floorTo = (n: number, decimals: number) => Math.floor(n * 10 ** decimals + 1e-9) / 10 ** decimals;
const ok = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

/** SOL to spend for `value` of `unit`; rounded DOWN to 6 decimals so it never asks for more than the user typed. */
export function unitToSol(unit: BuyUnit, value: number, rates: BuyRates): number | null {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (unit === "SOL") return value;
  if (!ok(rates.solUsd)) return null;
  if (unit === "USD") return floorTo(value / rates.solUsd, 6);
  if (!ok(rates.eurUsd)) return null;
  return floorTo((value * rates.eurUsd) / rates.solUsd, 6);
}

/** What `sol` is worth in `unit`, rounded to what a person reads (2 decimals; 4 for SOL). */
export function solToUnit(unit: BuyUnit, sol: number, rates: BuyRates): number | null {
  if (!Number.isFinite(sol) || sol < 0) return null;
  if (unit === "SOL") return sol;
  if (!ok(rates.solUsd)) return null;
  const usd = sol * rates.solUsd;
  if (unit === "USD") return usd;
  return ok(rates.eurUsd) ? usd / rates.eurUsd : null;
}

/** The largest figure in `unit` that still fits in `maxSol`, rounded DOWN so it is always affordable. */
export function maxInUnit(unit: BuyUnit, maxSol: number, rates: BuyRates): number | null {
  const v = solToUnit(unit, maxSol, rates);
  return v === null ? null : floorTo(v, unit === "SOL" ? 4 : 2);
}
