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

// ── Paying with any token the wallet holds ───────────────────────────────────────────────────────────────
// The same idea for any asset the buy is paid with (SOL, USDC, a token from the wallet…): the typed figure is
// either in the asset itself or a dollar/euro *view* of it, converted with that asset's real USD price. A missing
// price means the dollar/euro views can't be used for it (`null`) — never a guessed one.

/** What the typed figure means: the paying asset itself, or its value in dollars / euros. */
export type ViewUnit = "ASSET" | "USD" | "EUR";

/** How many of the paying asset `value` of `unit` buys; rounded DOWN (at most 6 decimals) so it never asks for more than was typed. */
export function assetFromUnit(unit: ViewUnit, value: number, assetUsd: number | null, eurUsd: number | null, decimals: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (unit === "ASSET") return value;
  if (!ok(assetUsd)) return null;
  const places = Math.min(decimals, 6);
  if (unit === "USD") return floorTo(value / assetUsd, places);
  if (!ok(eurUsd)) return null;
  return floorTo((value * eurUsd) / assetUsd, places);
}

/** What `amount` of the paying asset is worth in `unit` (unrounded — the caller formats it). */
export function unitFromAsset(unit: ViewUnit, amount: number, assetUsd: number | null, eurUsd: number | null): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (unit === "ASSET") return amount;
  if (!ok(assetUsd)) return null;
  const usd = amount * assetUsd;
  if (unit === "USD") return usd;
  return ok(eurUsd) ? usd / eurUsd : null;
}

/** The largest figure in `unit` that still fits in `maxAsset` of the paying asset, rounded DOWN so it is always affordable. */
export function maxInViewUnit(unit: ViewUnit, maxAsset: number, assetUsd: number | null, eurUsd: number | null, decimals: number): number | null {
  const v = unitFromAsset(unit, maxAsset, assetUsd, eurUsd);
  return v === null ? null : floorTo(v, unit === "ASSET" ? Math.min(decimals, 6) : 2);
}

/**
 * A whole-token figure as the integer string of base units a swap needs (`1.5` at 6 decimals → "1500000"), by string
 * arithmetic — a float times 10^9 loses digits above 2^53. Rounds DOWN; more decimals than the token has are cut off.
 */
export function toBaseUnits(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return "0";
  const keep = Math.min(decimals, 12);
  // 15 significant digits wipes the float's own noise (123456.789012 is stored as …78901199999) without inventing any; the
  // extra places are then cut, never rounded — truncating is what keeps this from ever asking for more than was typed.
  const text = value >= 1e-6 && value < 1e15 ? value.toPrecision(15) : value.toFixed(keep + 2);
  const [whole, frac = ""] = text.split(".");
  const digits = (whole + frac.slice(0, keep).padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return digits === "" ? "0" : digits;
}
