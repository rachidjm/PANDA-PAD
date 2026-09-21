import { PANDA_FEE_BPS } from "@/lib/pump/constants";
import { NETWORK_BUFFER_SOL } from "@/lib/trading/limits";

/**
 * "Draw Your Trade": the numbers behind a drawn BUY → SELL strategy. Pure functions only (no network, no
 * React), used both by the screen (to explain before anything is signed) and by the server (which re-checks
 * everything itself and never trusts what the browser computed).
 *
 * Prices are USD per token: that is what the chart shows and what Jupiter's Trigger engine watches
 * ("USD price of the trigger token crosses a threshold"), so nothing is converted or invented on the way.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * PANDA's fee on a strategy: 0.5% for its buy and 0.5% for its sell, so 1% of the amount invested, paid up front when
 * the strategy is confirmed. A strategy's sale happens later and by itself, so there is no moment to take a cut of the
 * proceeds: it is charged on the amount invested instead, and added to what the user pays. Always paid in SOL.
 */
export const STRATEGY_FEE_BPS = PANDA_FEE_BPS * 2;

/** The fee for investing `amountUsd`, in USD and in lamports of SOL. null when the SOL rate isn't known. */
export function strategyFee(amountUsd: number, solUsd: number | null): { feeUsd: number; feeLamports: number } | null {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !solUsd || solUsd <= 0) return null;
  const feeUsd = (amountUsd * STRATEGY_FEE_BPS) / 10_000;
  return { feeUsd, feeLamports: Math.floor((feeUsd / solUsd) * 1e9) };
}

/** Jupiter Trigger rejects price orders under 10 USD (documented). */
export const MIN_ORDER_USD = 10;
/** The pool must be able to absorb the order: fail closed when liquidity is unknown or tiny. */
export const MIN_LIQUIDITY_USD = 5_000;
export const MAX_ORDER_LIQUIDITY_SHARE = 0.05;
/** Slippage tolerances sent with the order. The stop-loss gets a wide one on purpose: a stop that doesn't execute protects nothing. */
export const BUY_SLIPPAGE_BPS = 500;
export const TP_SLIPPAGE_BPS = 500;
export const SL_SLIPPAGE_BPS = 2000;
/** Jupiter's OTOCO needs a stop-loss as well as a take-profit; PANDA suggests this one and lets the user change it. */
export const DEFAULT_STOP_PCT = 20;
export const STRATEGY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A buy target this close to the current price would fire immediately — that is a market buy, not a target. */
export const MIN_BUY_DISTANCE = 0.002;
/** Sanity bounds around the current price. */
export const MAX_PRICE_RATIO = 1000;

export type AmountUnit = "USD" | "EUR" | "SOL" | "USDC";
export type FundingAsset = "SOL" | "USDC";
export const FUNDING: Record<FundingAsset, { mint: string; decimals: number }> = {
  SOL: { mint: SOL_MINT, decimals: 9 },
  USDC: { mint: USDC_MINT, decimals: 6 },
};

/** Real, current reference rates. `null` = that source did not answer: the unit is then unavailable (never guessed). */
export type Rates = { solUsd: number | null; usdcUsd: number | null; eurUsd: number | null };

/** 4 significant digits: enough to place a line, and keeps 0.00001234567 from showing up as a "price". */
export function roundPrice(p: number): number {
  return Number.isFinite(p) && p > 0 ? Number(p.toPrecision(4)) : 0;
}

/** BUY fires when the market reaches the target: from above it is a "below" trigger, from below an "above" one. */
export function triggerConditionFor(buyUsd: number, currentUsd: number): "above" | "below" {
  return buyUsd <= currentUsd ? "below" : "above";
}

export function defaultStop(buyUsd: number): number {
  return roundPrice(buyUsd * (1 - DEFAULT_STOP_PCT / 100));
}

export type StrategyIssue =
  | "invalid_price"
  | "sell_not_above_buy"
  | "stop_not_below_buy"
  | "buy_too_close"
  | "too_far"
  | "below_minimum"
  | "price_unavailable"
  | "liquidity_unknown"
  | "liquidity_low"
  | "too_large_for_pool";

/**
 * Everything that must hold before a strategy can be confirmed. `liquidityUsd`: undefined = don't check (a
 * draft without a quote yet), null = the source didn't say (refused), a number = checked.
 */
export function validateStrategy(i: {
  buy: number;
  sell: number;
  stop: number;
  amountUsd: number | null;
  currentUsd: number | null;
  liquidityUsd?: number | null;
}): StrategyIssue[] {
  const issues: StrategyIssue[] = [];
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  if (!ok(i.buy) || !ok(i.sell) || !ok(i.stop)) return ["invalid_price"];
  // SELL can only ever come after BUY, so it must sit above it; the stop protects the position, so it sits below the entry.
  if (i.sell <= i.buy) issues.push("sell_not_above_buy");
  if (i.stop >= i.buy) issues.push("stop_not_below_buy");
  if (!i.currentUsd || !ok(i.currentUsd)) {
    issues.push("price_unavailable");
  } else {
    if (Math.abs(i.buy - i.currentUsd) / i.currentUsd < MIN_BUY_DISTANCE) issues.push("buy_too_close");
    const lo = i.currentUsd / MAX_PRICE_RATIO;
    const hi = i.currentUsd * MAX_PRICE_RATIO;
    if ([i.buy, i.sell, i.stop].some((p) => p < lo || p > hi)) issues.push("too_far");
  }
  if (i.amountUsd === null || !ok(i.amountUsd)) issues.push("price_unavailable");
  else if (i.amountUsd < MIN_ORDER_USD) issues.push("below_minimum");
  if (i.liquidityUsd === null) issues.push("liquidity_unknown");
  else if (i.liquidityUsd !== undefined) {
    if (i.liquidityUsd < MIN_LIQUIDITY_USD) issues.push("liquidity_low");
    else if (i.amountUsd !== null && i.amountUsd > i.liquidityUsd * MAX_ORDER_LIQUIDITY_SHARE) issues.push("too_large_for_pool");
  }
  return issues;
}

export type StrategyMetrics = {
  diff: number;
  pct: number;
  tokens: number;
  /** What the position is worth if it sells exactly at the SELL target. */
  grossReturnUsd: number;
  grossProfitUsd: number;
  /** Loss if the stop-loss triggers instead (exact price, no slippage). */
  stopLossUsd: number;
  stopLossPct: number;
  /** Profit if slippage is fully used on both legs — a bound, not a forecast. */
  worstCaseProfitUsd: number;
  /** What PANDA charges to set the strategy up (already included in the two `net` figures below). */
  feeUsd: number;
  /** Result if it sells exactly at the SELL target, after PANDA's fee. */
  netProfitUsd: number;
  /** Result if the stop triggers instead, after PANDA's fee. */
  netStopLossUsd: number;
};

/**
 * Estimates at the exact target prices. Jupiter's own fee is not published in its API documentation and
 * network fees vary, so neither is invented here: these figures are BEFORE fees and slippage, and the
 * worst-case line shows what full slippage on both legs would cost.
 */
export function strategyMetrics(i: { buy: number; sell: number; stop: number; amountUsd: number; feeUsd?: number }): StrategyMetrics {
  const feeUsd = i.feeUsd ?? 0;
  const tokens = i.amountUsd / i.buy;
  const grossReturnUsd = tokens * i.sell;
  const worstTokens = i.amountUsd / (i.buy * (1 + BUY_SLIPPAGE_BPS / 10_000));
  return {
    diff: i.sell - i.buy,
    pct: (i.sell / i.buy - 1) * 100,
    tokens,
    grossReturnUsd,
    grossProfitUsd: grossReturnUsd - i.amountUsd,
    stopLossUsd: tokens * i.stop - i.amountUsd,
    stopLossPct: (i.stop / i.buy - 1) * 100,
    worstCaseProfitUsd: worstTokens * i.sell * (1 - TP_SLIPPAGE_BPS / 10_000) - i.amountUsd - feeUsd,
    feeUsd,
    netProfitUsd: grossReturnUsd - i.amountUsd - feeUsd,
    netStopLossUsd: tokens * i.stop - i.amountUsd - feeUsd,
  };
}

/** What the user typed, in USD. `null` when the rate it needs isn't available (never guessed). */
export function amountToUsd(unit: AmountUnit, value: number, rates: Rates): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rate = unit === "USD" ? 1 : unit === "EUR" ? rates.eurUsd : unit === "SOL" ? rates.solUsd : rates.usdcUsd;
  return rate && rate > 0 ? value * rate : null;
}

/** The same amount expressed in another unit. null when a rate that is needed isn't available. */
export function convertAmount(from: AmountUnit, value: number, to: AmountUnit, rates: Rates): number | null {
  const usd = amountToUsd(from, value, rates);
  if (usd === null) return null;
  const rate = to === "USD" ? 1 : to === "EUR" ? rates.eurUsd : to === "SOL" ? rates.solUsd : rates.usdcUsd;
  return rate && rate > 0 ? usd / rate : null;
}

export type Funding = {
  asset: FundingAsset;
  mint: string;
  decimals: number;
  /** Amount of the asset, in UI units. */
  ui: number;
  /** Smallest units, as a decimal string (what the deposit is built with). */
  raw: string;
  usd: number;
  rateUsd: number;
  balanceKnown: boolean;
  /** PANDA's fee on top of `usd` (0 when the caller didn't ask for one). */
  feeUsd: number;
};

export type FundingResult =
  | { ok: true; funding: Funding }
  | { ok: false; reason: "invalid_amount" | "price_unavailable" | "insufficient"; shortfallUsd?: number };

function toRaw(ui: number, decimals: number): string {
  return BigInt(Math.floor(ui * 10 ** decimals + 1e-9)).toString();
}

/**
 * The user types a figure; PANDA decides which coin pays for it. SOL or USDC typed as the unit forces that coin.
 * With USD/EUR, the coin the wallet holds the most of (in dollars) pays, unless the user picked one; if the
 * larger one can't cover it but the other can, the other is used. Balances are for the UI only: the chain is
 * the real check (a deposit that doesn't fit simply fails).
 */
export function chooseFunding(i: {
  unit: AmountUnit;
  value: number;
  rates: Rates;
  balances: { sol: number | null; usdc: number | null };
  preferred?: FundingAsset | null;
  /** PANDA's fee, in basis points of the amount: it is paid in SOL ON TOP of the amount, so the wallet must cover both. */
  feeBps?: number;
}): FundingResult {
  const usd = amountToUsd(i.unit, i.value, i.rates);
  if (!Number.isFinite(i.value) || i.value <= 0) return { ok: false, reason: "invalid_amount" };
  if (usd === null) return { ok: false, reason: "price_unavailable" };

  const rateOf = (a: FundingAsset) => (a === "SOL" ? i.rates.solUsd : i.rates.usdcUsd);
  const spendable = (a: FundingAsset): number | null =>
    a === "SOL" ? (i.balances.sol === null ? null : Math.max(0, i.balances.sol - NETWORK_BUFFER_SOL)) : i.balances.usdc;
  const valueUsd = (a: FundingAsset) => {
    const b = spendable(a);
    const r = rateOf(a);
    return b === null || !r ? null : b * r;
  };
  const build = (asset: FundingAsset): FundingResult => {
    const rate = rateOf(asset);
    if (!rate || rate <= 0) return { ok: false, reason: "price_unavailable" };
    const ui = i.unit === asset ? i.value : usd / rate;
    const { mint, decimals } = FUNDING[asset];
    const raw = toRaw(ui, decimals);
    if (raw === "0") return { ok: false, reason: "invalid_amount" };
    const bal = valueUsd(asset);
    const feeUsd = (usd * (i.feeBps ?? 0)) / 10_000;
    // The fee is always paid in SOL: with SOL it comes out of the same balance as the amount, with USDC out of the SOL the wallet holds.
    if (asset === "SOL") {
      if (bal !== null && usd + feeUsd > bal + 1e-9) return { ok: false, reason: "insufficient", shortfallUsd: usd + feeUsd - bal };
    } else {
      if (bal !== null && usd > bal + 1e-9) return { ok: false, reason: "insufficient", shortfallUsd: usd - bal };
      const sol = valueUsd("SOL");
      if (feeUsd > 0 && sol !== null && feeUsd > sol + 1e-9) return { ok: false, reason: "insufficient", shortfallUsd: feeUsd - sol };
    }
    return { ok: true, funding: { asset, mint, decimals, ui, raw, usd, rateUsd: rate, balanceKnown: bal !== null, feeUsd } };
  };

  if (i.unit === "SOL" || i.unit === "USDC") return build(i.unit);
  if (i.preferred) return build(i.preferred);

  const order: FundingAsset[] = ["SOL", "USDC"];
  const vals = order.map((a) => ({ a, v: valueUsd(a) }));
  // Nothing known about balances: default to SOL (every wallet has some), the deposit itself is the real check.
  if (vals.every((x) => x.v === null)) return build("SOL");
  vals.sort((x, y) => (y.v ?? -1) - (x.v ?? -1));
  const first = build(vals[0].a);
  if (first.ok || vals[1].v === null) return first;
  const second = build(vals[1].a);
  return second.ok ? second : first;
}

/** The coin to pay with when the user hasn't picked one: the one the wallet holds the most of (in dollars); SOL when nothing is known. */
export function preferredFunding(balances: { sol: number | null; usdc: number | null }, rates: Rates): FundingAsset {
  const sol = balances.sol !== null && rates.solUsd ? Math.max(0, balances.sol - NETWORK_BUFFER_SOL) * rates.solUsd : null;
  const usdc = balances.usdc !== null && rates.usdcUsd ? balances.usdc * rates.usdcUsd : null;
  if (sol === null && usdc === null) return "SOL";
  return (usdc ?? -1) > (sol ?? -1) ? "USDC" : "SOL";
}
