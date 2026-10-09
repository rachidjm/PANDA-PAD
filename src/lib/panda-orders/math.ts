/**
 * PANDA orders — pure rules, no I/O. A PANDA order is a sale of a coin the wallet ALREADY holds (Pump.fun curve or
 * PumpSwap only), pre-signed by the user with a durable nonce and kept (encrypted) by PANDA until its price is reached.
 * The user signs an exact condition: "sell THIS many tokens and receive AT LEAST this many lamports". Nothing PANDA
 * does later can change that: if the market can't pay it, the transaction fails and nothing is sold.
 *
 * How a price drawn on the chart becomes that condition: at signing, PANDA asks the curve/pool what selling the
 * amount would pay right now (`currentOut`, exact, fees included) and scales it by how far the drawn price is from the
 * current one. That scaled figure is the trigger; the signed minimum is the trigger minus a small margin.
 *   take-profit: sent when the live quote ≥ trigger; signed minimum = trigger × (1 − SELL_MARGIN_BPS)
 *   stop:        sent when the live quote ≤ trigger; signed minimum = trigger × (1 − STOP_MARGIN_BPS)
 * The watcher compares the SAME unit (lamports out for this exact amount), so "triggered" and "executable" agree.
 */

export type Leg = "sell" | "stop";
export type Venue = "curve" | "amm";
export type OrderState = "prepared" | "active" | "sending" | "executed" | "cancelled" | "needs_resign";

/** States in which an order still holds its nonce account (and its signed bytes may still be sent). */
export const LIVE_STATES: readonly OrderState[] = ["prepared", "active", "sending"];
export const TERMINAL_STATES: readonly OrderState[] = ["executed", "cancelled", "needs_resign"];

/** Take-profit: may fill at most 1% under the drawn target (absorbs the move between the check and the block). */
export const SELL_MARGIN_BPS = 100;
/** Stop: the "small slippage margin below the marked price" — 3%. Below that, the stop does NOT sell (the user accepts this). */
export const STOP_MARGIN_BPS = 300;
/** One nonce account per tranche, one popup for all of them: kept small so the setup and close transactions fit. */
export const MAX_TRANCHES = 8;
/** A prepared (unsigned) order is forgotten after this long. */
export const PREPARED_TTL_MS = 15 * 60_000;
/** Compute budget fixed at signing (the server can't add a priority fee later without breaking the signature). */
export const ORDER_CU_LIMIT = 200_000;
export const ORDER_CU_PRICE_MICRO_LAMPORTS = 100_000;
/** Rough network cost of one execution, paid by the user's wallet: 5,000 base + the fixed priority fee. */
export const EXECUTION_FEE_LAMPORTS = 5_000 + Math.ceil((ORDER_CU_LIMIT * ORDER_CU_PRICE_MICRO_LAMPORTS) / 1_000_000);

const BPS = BigInt(10_000);

/** `pct` (0.1–100, one decimal) of `availableRaw`, rounded DOWN to a whole raw unit. 0 for anything out of range. */
export function amountForPct(availableRaw: bigint, pct: number): bigint {
  if (!(pct > 0) || pct > 100 || availableRaw <= BigInt(0)) return BigInt(0);
  const tenths = BigInt(Math.round(pct * 10));
  return (availableRaw * tenths) / BigInt(1000);
}

/** Lamports out that correspond to the drawn price: the live quote for this amount, scaled by drawn/current. */
export function triggerOutFor(currentOutLamports: bigint, targetUsd: number, currentUsd: number): bigint {
  if (!(targetUsd > 0) || !(currentUsd > 0) || currentOutLamports <= BigInt(0)) return BigInt(0);
  // Ratio with 9 decimals of precision, in integers, so nothing is lost to float rounding on big amounts.
  const scale = BigInt(1_000_000_000);
  const ratio = BigInt(Math.round((targetUsd / currentUsd) * 1e9));
  return (currentOutLamports * ratio) / scale;
}

export function marginBps(leg: Leg): number {
  return leg === "stop" ? STOP_MARGIN_BPS : SELL_MARGIN_BPS;
}

/** The minimum the user signs: the trigger minus this leg's margin, rounded down. */
export function minOutFor(triggerOut: bigint, leg: Leg): bigint {
  return (triggerOut * (BPS - BigInt(marginBps(leg)))) / BPS;
}

/** PANDA's fee on a PANDA order: the wallet's per-trade bps of the GUARANTEED minimum (never of more than it can receive). */
export function feeFor(minOut: bigint, feeBps: number): bigint {
  if (!(feeBps > 0)) return BigInt(0);
  return (minOut * BigInt(Math.round(feeBps))) / BPS;
}

/** Whether the live quote has reached this order's level. */
export function isTriggered(leg: Leg, liveOut: bigint, triggerOut: bigint): boolean {
  return leg === "sell" ? liveOut >= triggerOut : liveOut <= triggerOut;
}

export type DrawnTranche = { trancheId: string; pct: number; sellUsd?: number; stopUsd?: number };
export type TrancheIssue =
  | "invalid"
  | "too_many"
  | "over_100"
  | "sell_not_above_current"
  | "stop_not_below_current"
  | "tp_not_above_stop"
  | "too_far"
  | "amount_zero";

/** Prices drawn more than this many times away from the current one are refused (a typo, not a target). */
export const MAX_PRICE_RATIO = 50;

/** Everything about the drawing itself that must hold before anything is read from the chain. */
export function validateTranches(tranches: DrawnTranche[], currentUsd: number): Map<string, TrancheIssue[]> | TrancheIssue {
  if (!Array.isArray(tranches) || tranches.length === 0) return "invalid";
  if (tranches.length > MAX_TRANCHES) return "too_many";
  const total = tranches.reduce((s, t) => s + (Number.isFinite(t.pct) ? t.pct : 0), 0);
  if (total > 100.0001) return "over_100";
  const out = new Map<string, TrancheIssue[]>();
  const ids = new Set<string>();
  for (const t of tranches) {
    const issues: TrancheIssue[] = [];
    const okPrice = (p: number | undefined) => p === undefined || (typeof p === "number" && Number.isFinite(p) && p > 0);
    if (typeof t.trancheId !== "string" || !/^[A-Za-z0-9-]{4,64}$/.test(t.trancheId) || ids.has(t.trancheId)) issues.push("invalid");
    ids.add(t.trancheId);
    if (!(typeof t.pct === "number" && t.pct >= 0.1 && t.pct <= 100)) issues.push("invalid");
    if (!okPrice(t.sellUsd) || !okPrice(t.stopUsd) || (t.sellUsd === undefined && t.stopUsd === undefined)) issues.push("invalid");
    if (!issues.length && currentUsd > 0) {
      if (t.sellUsd !== undefined && t.sellUsd <= currentUsd) issues.push("sell_not_above_current");
      if (t.stopUsd !== undefined && t.stopUsd >= currentUsd) issues.push("stop_not_below_current");
      if (t.sellUsd !== undefined && t.stopUsd !== undefined && t.sellUsd <= t.stopUsd) issues.push("tp_not_above_stop");
      for (const p of [t.sellUsd, t.stopUsd]) if (p !== undefined && (p > currentUsd * MAX_PRICE_RATIO || p < currentUsd / MAX_PRICE_RATIO)) issues.push("too_far");
    }
    out.set(t.trancheId, issues);
  }
  return out;
}

/** Tokens already promised to this wallet's live orders on one coin — counted ONCE per nonce account (a sell and a
 *  stop of the same tranche share it and sell the same tokens: whichever fills first invalidates the other). */
export function committedRaw(orders: { nonceAccount: string; tokenAmountRaw: string; state: OrderState }[]): bigint {
  const byNonce = new Map<string, bigint>();
  for (const o of orders) {
    if (!LIVE_STATES.includes(o.state)) continue;
    const amount = BigInt(o.tokenAmountRaw);
    const prev = byNonce.get(o.nonceAccount) ?? BigInt(0);
    if (amount > prev) byNonce.set(o.nonceAccount, amount);
  }
  let sum = BigInt(0);
  for (const v of byNonce.values()) sum += v;
  return sum;
}

/** Why a simulation (or a landed transaction) failed, in the terms the user and the watcher act on. */
export type FailureKind =
  | "slippage" // the market can't pay the signed minimum right now — nothing wrong with the order
  | "no_balance" // the wallet no longer has the tokens
  | "no_sol" // the wallet can't pay the network fee
  | "migrated" // the coin left the bonding curve (PumpSwap now): this transaction can never work
  | "program_changed" // Pump changed what its sell instruction needs: re-sign
  | "nonce_used" // the nonce moved on: the twin leg filled, or the user cancelled
  | "unknown";

export function classifyFailure(err: unknown, logs: string[] | null | undefined): FailureKind {
  const text = (logs ?? []).join("\n");
  const e = typeof err === "string" ? err : JSON.stringify(err ?? "");
  if (/BlockhashNotFound|BlockhashNotFound|AlreadyProcessed/.test(e)) return "nonce_used";
  if (/InsufficientFundsForFee|"AccountNotFound"|AccountNotFound/.test(e)) return "no_sol";
  if (/TooLittleSolReceived|ExceededSlippage|slippage/i.test(text)) return "slippage";
  if (/BondingCurveComplete/.test(text)) return "migrated";
  if (/NotEnoughTokensToSell|Error: insufficient funds|InsufficientFunds\b/.test(text)) return "no_balance";
  if (/InsufficientFundsForRent/.test(e) || /insufficient lamports/.test(text)) return "no_sol";
  if (/NotAuthorized|FeeRecipientNotAuthorized|BuybackFeeRecipientNotAuthorized|AccountNotEnoughKeys|ConstraintSeeds|ConstraintAddress|ConstraintHasOne|AccountDiscriminatorMismatch|AccountOwnedByWrongProgram|InvalidProgramId|DeclaredProgramIdMismatch|InstructionFallbackNotFound|InvalidAccountData|IncorrectProgramId/.test(text + e)) {
    return "program_changed";
  }
  return "unknown";
}

/** What an order becomes after a failed check. `null` = it stays active (worth retrying later). */
export function stateAfterFailure(kind: FailureKind, consecutiveUnknown: number): { state: OrderState; reason: string } | null {
  switch (kind) {
    case "slippage":
      return null;
    case "nonce_used":
      return { state: "cancelled", reason: "nonce_used" };
    case "migrated":
    case "program_changed":
    case "no_balance":
      return { state: "needs_resign", reason: kind };
    case "no_sol":
      return null; // the user can top up SOL and it works again — told in the bell, not invalidated
    case "unknown":
      return consecutiveUnknown >= 3 ? { state: "needs_resign", reason: "unknown" } : null;
  }
}
