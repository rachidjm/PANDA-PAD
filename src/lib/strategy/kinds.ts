import type { CreateOrderParams } from "@/lib/jupiter/trigger";
import { BUY_SLIPPAGE_BPS, MIN_BUY_DISTANCE, MIN_LIQUIDITY_USD, MIN_ORDER_USD, MAX_ORDER_LIQUIDITY_SHARE, MAX_PRICE_RATIO, SL_SLIPPAGE_BPS, TP_SLIPPAGE_BPS, validateStrategy, type StrategyIssue } from "./plan";

/**
 * Which orders a Draw Your Trade submission is made of. Every shape maps to ONE native Jupiter Trigger order
 * (documented at developers.jup.ag/docs/trigger/create-order), and only these shapes are accepted:
 *
 *   buy            → single   buy at a price (funding asset → token)
 *   sell           → single   sell a token the wallet already holds, when the price reaches the target
 *   stop           → single   sell a held token when the price falls to the stop
 *   sell + stop    → oco      one deposit of held tokens; whichever of take-profit / stop fills first cancels the other
 *   buy+sell+stop  → otoco    buy at the target, then take-profit / stop on what was bought (the existing strategy)
 *
 * Buy + sell and buy + stop are NOT offered: Jupiter's OTOCO needs both a take-profit and a stop-loss, so a
 * buy with only one of them has no native order. Anything else is rejected by the server.
 */

export type OrderKind = "buy" | "sell" | "stop" | "sell_stop" | "buy_sell_stop";
export type JupiterOrderType = "single" | "oco" | "otoco";
export type Legs = { buy?: number; sell?: number; stop?: number };

export function kindOf(legs: Legs): OrderKind | null {
  const b = legs.buy !== undefined;
  const s = legs.sell !== undefined;
  const t = legs.stop !== undefined;
  if (b && s && t) return "buy_sell_stop";
  if (b && !s && !t) return "buy";
  if (!b && s && !t) return "sell";
  if (!b && !s && t) return "stop";
  if (!b && s && t) return "sell_stop";
  return null;
}

export const ORDER_TYPE: Record<OrderKind, JupiterOrderType> = {
  buy: "single",
  sell: "single",
  stop: "single",
  sell_stop: "oco",
  buy_sell_stop: "otoco",
};

/** Whether the order starts with a buy (funding asset in) or sells tokens the wallet already holds. */
export const startsWithBuy = (kind: OrderKind): boolean => kind === "buy" || kind === "buy_sell_stop";

export const KIND_LABEL: Record<OrderKind, string> = {
  buy: "buy",
  sell: "sell",
  stop: "stop",
  sell_stop: "sell_stop",
  buy_sell_stop: "buy_sell_stop",
};

/** New issues for the shapes that don't buy first. Existing buy issues come from plan.ts unchanged. */
export type KindIssue = StrategyIssue | "unsupported_combination" | "sell_not_above_current" | "sell_too_close" | "stop_not_below_current" | "stop_too_close" | "no_balance" | "tp_not_above_stop";

export type KindContext = {
  currentUsd: number | null;
  /** USD the buy spends (buy kinds). */
  amountUsd?: number | null;
  /** USD value of the tokens being sold (held-token kinds), at the current price. */
  tokensUsd?: number | null;
  /** undefined = no liquidity check yet (a draft), null = the source didn't say, a number = checked. */
  liquidityUsd?: number | null;
  /** The per-order floor. Jupiter's is MIN_ORDER_USD (the default); a PANDA order (src/lib/panda-orders) has none: 0. */
  minOrderUsd?: number;
};

/** Everything that must hold for one order shape to be placed. Buy shapes reuse plan.ts's rules exactly. */
export function validateKind(kind: OrderKind, legs: Legs, c: KindContext): KindIssue[] {
  if (kind === "buy_sell_stop") {
    return validateStrategy({ buy: legs.buy!, sell: legs.sell!, stop: legs.stop!, amountUsd: c.amountUsd ?? null, currentUsd: c.currentUsd, liquidityUsd: c.liquidityUsd });
  }
  const issues: KindIssue[] = [];
  const prices = [legs.buy, legs.sell, legs.stop].filter((p): p is number => p !== undefined);
  if (prices.some((p) => !Number.isFinite(p) || p <= 0)) return ["invalid_price"];
  if (!c.currentUsd || c.currentUsd <= 0) return ["price_unavailable"];
  const cur = c.currentUsd;
  const lo = cur / MAX_PRICE_RATIO;
  const hi = cur * MAX_PRICE_RATIO;
  if (prices.some((p) => p < lo || p > hi)) issues.push("too_far");

  if (kind === "buy") {
    if (Math.abs(legs.buy! - cur) / cur < MIN_BUY_DISTANCE) issues.push("buy_too_close");
  }
  if (legs.sell !== undefined) {
    // A take-profit or a sale target at or below the price would fire at once: that's a market order, not a target.
    if (legs.sell <= cur) issues.push("sell_not_above_current");
    else if ((legs.sell - cur) / cur < MIN_BUY_DISTANCE) issues.push("sell_too_close");
  }
  if (legs.stop !== undefined) {
    if (legs.stop >= cur) issues.push("stop_not_below_current");
    else if ((cur - legs.stop) / cur < MIN_BUY_DISTANCE) issues.push("stop_too_close");
  }
  if (kind === "sell_stop" && legs.sell! <= legs.stop!) issues.push("tp_not_above_stop");

  if (startsWithBuy(kind)) {
    if (c.amountUsd === null || c.amountUsd === undefined || !(c.amountUsd > 0)) issues.push("price_unavailable");
    else if (c.amountUsd < MIN_ORDER_USD) issues.push("below_minimum");
  } else {
    if (c.tokensUsd === null || c.tokensUsd === undefined || !(c.tokensUsd > 0)) issues.push("no_balance");
    else if (c.tokensUsd < (c.minOrderUsd ?? MIN_ORDER_USD)) issues.push("below_minimum");
  }

  const size = startsWithBuy(kind) ? c.amountUsd : c.tokensUsd;
  if (c.liquidityUsd === null) issues.push("liquidity_unknown");
  else if (c.liquidityUsd !== undefined) {
    if (c.liquidityUsd < MIN_LIQUIDITY_USD) issues.push("liquidity_low");
    else if (size && size > c.liquidityUsd * MAX_ORDER_LIQUIDITY_SHARE) issues.push("too_large_for_pool");
  }
  return issues;
}

/** The part of a held balance that a sell order may use: `pct` percent, rounded DOWN to a whole raw unit. */
export function sellAmountRaw(balanceRaw: bigint, pct: number): bigint {
  if (!(pct > 0) || pct > 100 || balanceRaw <= BigInt("0")) return BigInt("0");
  const scaled = Math.round(pct * 1000); // tenths of a percent, so 33.3% stays exact
  return (balanceRaw * BigInt(scaled)) / BigInt("100000");
}

/** Builds Jupiter's exact create-order request for one shape. Pure, so the field mapping is tested directly. */
export function jupiterOrderParams(
  kind: OrderKind,
  p: {
    wallet: string;
    mint: string;
    settlementMint: string;
    fundingMint: string;
    inputAmountRaw: string;
    legs: Legs;
    buyCondition?: "above" | "below";
    depositRequestId: string;
    depositSignedTx: string;
    expiresAt: number;
  }
): CreateOrderParams {
  const base = {
    depositRequestId: p.depositRequestId,
    depositSignedTx: p.depositSignedTx,
    userPubkey: p.wallet,
    expiresAt: p.expiresAt,
  };
  switch (kind) {
    case "buy":
      return { ...base, orderType: "single", inputMint: p.fundingMint, outputMint: p.mint, triggerMint: p.mint, inputAmount: p.inputAmountRaw, triggerCondition: p.buyCondition!, triggerPriceUsd: p.legs.buy, slippageBps: BUY_SLIPPAGE_BPS };
    case "sell":
      return { ...base, orderType: "single", inputMint: p.mint, outputMint: p.settlementMint, triggerMint: p.mint, inputAmount: p.inputAmountRaw, triggerCondition: "above", triggerPriceUsd: p.legs.sell, slippageBps: TP_SLIPPAGE_BPS };
    case "stop":
      return { ...base, orderType: "single", inputMint: p.mint, outputMint: p.settlementMint, triggerMint: p.mint, inputAmount: p.inputAmountRaw, triggerCondition: "below", triggerPriceUsd: p.legs.stop, slippageBps: SL_SLIPPAGE_BPS };
    case "sell_stop":
      return { ...base, orderType: "oco", inputMint: p.mint, outputMint: p.settlementMint, triggerMint: p.mint, inputAmount: p.inputAmountRaw, tpPriceUsd: p.legs.sell, slPriceUsd: p.legs.stop, tpSlippageBps: TP_SLIPPAGE_BPS, slSlippageBps: SL_SLIPPAGE_BPS };
    case "buy_sell_stop":
      throw new Error("buy_sell_stop is built by service.ts's existing otoco path");
  }
}
