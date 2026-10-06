import { PublicKey } from "@solana/web3.js";
import type { CreateOrderParams, DepositCraft, TriggerOrder } from "@/lib/jupiter/trigger";
import {
  FUNDING,
  amountToUsd,
  BUY_SLIPPAGE_BPS,
  chooseFunding,
  SL_SLIPPAGE_BPS,
  strategyFee,
  strategyFeeBps,
  STRATEGY_TTL_MS,
  TP_SLIPPAGE_BPS,
  triggerConditionFor,
  validateStrategy,
  type AmountUnit,
  type FundingAsset,
  type StrategyIssue,
} from "./plan";
import { deriveStatus, canAdvance } from "./status";
import { jupiterOrderParams, kindOf, ORDER_TYPE, sellAmountRaw, startsWithBuy, validateKind, type KindIssue, type Legs, type OrderKind } from "./kinds";
import type { FeeCheck } from "./fee";
import { listStrategies, PREPARED_TTL_MS, putPrepared, transition } from "./store";
import type { StrategyRecord } from "./types";
import { TERMINAL } from "./types";
import type { StrategyQuote } from "./market";

/**
 * The server side of "Draw Your Trade". It does not watch prices and it does not sign anything: the order
 * that actually waits for the price, buys, and sells lives in Jupiter's Trigger engine (an OTOCO order:
 * "when price reaches BUY, buy; then take profit at SELL or stop at STOP, whichever comes first"), so it keeps
 * running with the browser closed. This file prepares that order from numbers it re-checks itself, submits it
 * exactly once, and later reads back what really happened.
 */

export type Deps = {
  now: () => number;
  engineConfigured: () => boolean;
  quote: (mint: string) => Promise<StrategyQuote>;
  jupiter: {
    craftDeposit: (params: Parameters<typeof import("@/lib/jupiter/trigger").craftDeposit>[0], token: string) => Promise<DepositCraft>;
    createOrder: (params: CreateOrderParams, token: string) => Promise<{ id: string }>;
    listOrders: (token: string, params: { state: "active" | "past"; limit: number }) => Promise<{ orders: TriggerOrder[] }>;
  };
  /** True only for a signature that is confirmed on-chain and did not fail. */
  verifyTx: (signature: string) => Promise<boolean>;
  /** The wallet's raw balance of one mint (sum over its token accounts) and that mint's decimals. */
  balance: (wallet: string, mint: string) => Promise<{ raw: bigint; decimals: number }>;
  /** This wallet's own per-trade fee bps right now (src/lib/pump/fee-tier.ts's feeBpsForWallet) — the strategy's
   *  own fee is double this (one buy leg, one sell leg; see strategyFeeBps in ./plan). */
  feeBps: (wallet: string) => Promise<number>;
  /** PANDA's fee: a SOL transfer to the treasury, built here, signed by the wallet, checked here and only then sent. */
  fee: {
    treasury: string;
    /** False when the treasury can't receive a transfer this small (see fee-transfer.ts): then no fee is asked for. */
    canReceive: (lamports: number) => Promise<boolean>;
    build: (wallet: string, lamports: number) => Promise<string>;
    check: (signedBase64: unknown, expected: { wallet: string; treasury: string; lamports: number }) => FeeCheck;
    send: (signedBase64: string) => Promise<string>;
  };
};

export type Failure = {
  ok: false;
  status: number;
  code: "engine_unavailable" | "invalid" | "price_unavailable" | "issues" | "conflict" | "limit" | "expired" | "jupiter_error" | "not_found";
  message: string;
  issues?: (StrategyIssue | KindIssue)[];
};
const fail = (status: number, code: Failure["code"], message: string, issues?: (StrategyIssue | KindIssue)[]): Failure => ({ ok: false, status, code, message, issues });

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const validKey = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  try {
    return new PublicKey(s).toBytes().length === 32;
  } catch {
    return false;
  }
};

export type PrepareInput = {
  wallet: string;
  token: string;
  id: unknown;
  n: unknown;
  mint: unknown;
  ticker: unknown;
  buyUsd: unknown;
  sellUsd: unknown;
  stopUsd: unknown;
  amount: { unit: unknown; value: unknown };
  fundingAsset: unknown;
  /** Grouping metadata for a multi-tranche strategy — display-only, never used for a money check (each
   *  leg's own `amount` above is what's actually deposited and is validated on its own, same as always). */
  groupId?: unknown;
  legIndex?: unknown;
  legCount?: unknown;
  legPct?: unknown;
  /** For the shapes that sell a held token: the share of the balance to sell, 1–100. */
  sellPct?: unknown;
};

/** The legs that were sent: a price is either a positive number or absent. Anything else is refused. */
function parseLegs(i: { buyUsd: unknown; sellUsd: unknown; stopUsd: unknown }): { ok: true; value: Legs } | { ok: false } {
  const out: Legs = {};
  for (const [key, v] of [["buy", i.buyUsd], ["sell", i.sellUsd], ["stop", i.stopUsd]] as const) {
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return { ok: false };
    out[key] = v;
  }
  return { ok: true, value: out };
}

export async function prepareStrategy(deps: Deps, i: PrepareInput): Promise<Failure | { ok: true; record: StrategyRecord; transaction: string; feeTransaction: string | null }> {
  if (!deps.engineConfigured()) return fail(503, "engine_unavailable", "The order engine isn't configured on this deployment.");
  const { id, n, mint, buyUsd, sellUsd, stopUsd } = i;
  const unit = i.amount.unit as AmountUnit;
  const value = Number(i.amount.value);
  if (typeof id !== "string" || !ID_RE.test(id)) return fail(400, "invalid", "Invalid strategy id.");
  if (!validKey(i.wallet) || !validKey(mint)) return fail(400, "invalid", "Invalid wallet or token address.");
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 999) return fail(400, "invalid", "Invalid strategy number.");
  const legs = parseLegs({ buyUsd, sellUsd, stopUsd });
  if (!legs.ok) return fail(400, "invalid", "Invalid target prices.");
  const kind = kindOf(legs.value);
  if (!kind) return fail(400, "invalid", "That combination of orders isn't offered.");
  if (!["USD", "EUR", "SOL", "USDC"].includes(unit)) return fail(400, "invalid", "Invalid amount unit.");
  const preferred = i.fundingAsset === "SOL" || i.fundingAsset === "USDC" ? (i.fundingAsset as FundingAsset) : null;
  const ticker = typeof i.ticker === "string" && /^[\w.$-]{1,16}$/.test(i.ticker) ? i.ticker : "?";

  // Grouping metadata (a multi-tranche strategy's siblings) — malformed input is simply dropped, never a
  // reason this leg's own order can't be prepared: it just displays as an ungrouped, single-leg strategy.
  const groupId = typeof i.groupId === "string" && ID_RE.test(i.groupId) ? i.groupId : undefined;
  const legIndex = Number.isInteger(i.legIndex) && (i.legIndex as number) >= 0 && (i.legIndex as number) < 10 ? (i.legIndex as number) : undefined;
  const legCount = Number.isInteger(i.legCount) && (i.legCount as number) >= 1 && (i.legCount as number) <= 10 ? (i.legCount as number) : undefined;
  const legPct = typeof i.legPct === "number" && Number.isFinite(i.legPct) && i.legPct > 0 && i.legPct <= 100 ? i.legPct : undefined;

  // Every number that matters is re-read here; nothing the browser computed is trusted — including the fee
  // rate itself: it's this wallet's own (src/lib/pump/fee-tier.ts), never a flat constant.
  const [quote, tradeFeeBps] = await Promise.all([deps.quote(mint as string), deps.feeBps(i.wallet)]);
  if (!quote.tokenUsd) return fail(503, "price_unavailable", "No live price for this token right now.");
  if (kind !== "buy_sell_stop") {
    return prepareShape(deps, { wallet: i.wallet, token: i.token, id: id as string, n: n as number, mint: mint as string, ticker, kind, legs: legs.value, unit, value, sellPct: i.sellPct, preferred }, quote, tradeFeeBps);
  }
  const amountUsd = amountToUsd(unit, value, quote);
  const funding = chooseFunding({ unit, value, rates: quote, balances: { sol: null, usdc: null }, preferred, feeBps: strategyFeeBps(tradeFeeBps) });
  if (!funding.ok) {
    return fail(funding.reason === "invalid_amount" ? 400 : 503, funding.reason === "invalid_amount" ? "invalid" : "price_unavailable", "That amount can't be converted right now.");
  }
  const issues = validateStrategy({
    buy: buyUsd as number,
    sell: sellUsd as number,
    stop: stopUsd as number,
    amountUsd,
    currentUsd: quote.tokenUsd,
    liquidityUsd: quote.liquidityUsd,
  });
  if (issues.length) return fail(422, "issues", "This strategy can't be placed as drawn.", issues);

  // PANDA's fee is worked out here from the server's own rates and added on top of what is invested.
  let fee = strategyFee(funding.funding.usd, quote.solUsd, tradeFeeBps);
  if (!fee) return fail(503, "price_unavailable", "No live SOL rate to work out the fee right now.");
  if (fee.feeLamports <= 0) return fail(400, "invalid", "That amount is too small.");
  // A fee the treasury can't receive would make the fee transaction fail after the order exists: better none than that.
  if (!(await deps.fee.canReceive(fee.feeLamports))) fee = { feeUsd: 0, feeLamports: 0 };

  const now = deps.now();
  const condition = triggerConditionFor(buyUsd as number, quote.tokenUsd);
  let deposit: DepositCraft;
  try {
    deposit = await deps.jupiter.craftDeposit(
      { inputMint: funding.funding.mint, outputMint: mint as string, userAddress: i.wallet, amount: funding.funding.raw, orderType: "price", orderSubType: "otoco" },
      i.token
    );
  } catch (err) {
    return fail(502, "jupiter_error", clip(err));
  }

  let feeTransaction: string | null = null;
  try {
    feeTransaction = fee.feeLamports > 0 ? await deps.fee.build(i.wallet, fee.feeLamports) : null;
  } catch (err) {
    return fail(502, "jupiter_error", clip(err));
  }

  const record: StrategyRecord = {
    id,
    n: n as number,
    wallet: i.wallet,
    mint: mint as string,
    ticker,
    buyUsd: buyUsd as number,
    sellUsd: sellUsd as number,
    stopUsd: stopUsd as number,
    triggerCondition: condition,
    ...(groupId ? { groupId } : {}),
    ...(legIndex !== undefined ? { legIndex } : {}),
    ...(legCount !== undefined ? { legCount } : {}),
    ...(legPct !== undefined ? { legPct } : {}),
    fundingAsset: funding.funding.asset,
    fundingMint: funding.funding.mint,
    inputAmountRaw: funding.funding.raw,
    amountUsd: funding.funding.usd,
    feeLamports: fee.feeLamports,
    feeState: fee.feeLamports > 0 ? "prepared" : "none",
    state: "prepared",
    depositRequestId: deposit.requestId,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + STRATEGY_TTL_MS,
  };
  const put = await putPrepared(record, now);
  if (!put.ok) {
    if (put.reason === "exists") return fail(409, "conflict", "This strategy was already submitted.");
    return fail(429, "limit", put.reason === "limit" ? "Too many strategies on this wallet." : "Too many strategies waiting to be confirmed.");
  }
  return { ok: true, record, transaction: deposit.transaction, feeTransaction };
}

export async function createStrategy(
  deps: Deps,
  i: { wallet: string; token: string; id: unknown; depositSignedTx: unknown; feeSignedTx?: unknown }
): Promise<Failure | { ok: true; record: StrategyRecord }> {
  if (!deps.engineConfigured()) return fail(503, "engine_unavailable", "The order engine isn't configured on this deployment.");
  if (typeof i.id !== "string" || !ID_RE.test(i.id)) return fail(400, "invalid", "Invalid strategy id.");
  if (typeof i.depositSignedTx !== "string" || i.depositSignedTx.length < 100 || i.depositSignedTx.length > 20_000) return fail(400, "invalid", "Missing signed deposit.");
  const now = deps.now();

  // The fee has to be there, and be exactly what was agreed, BEFORE the order is touched.
  const pending = (await listStrategies(i.wallet, now)).find((s) => s.id === i.id);
  if (pending && pending.state === "prepared" && pending.feeLamports > 0) {
    const check = deps.fee.check(i.feeSignedTx, { wallet: i.wallet, treasury: deps.fee.treasury, lamports: pending.feeLamports });
    if (!check.ok) return fail(400, "invalid", `The fee payment is missing or wrong (${check.reason}).`);
  }

  // Prepared → creating, atomically: a second request for the same strategy finds it already taken.
  const record = await transition(i.wallet, i.id, ["prepared"], { state: "creating" }, now);
  if (!record) {
    const existing = (await listStrategies(i.wallet, now)).find((s) => s.id === i.id);
    return existing ? fail(409, "conflict", "This strategy was already submitted.") : fail(404, "not_found", "Nothing prepared for this strategy — start again.");
  }
  if (now - record.createdAt > PREPARED_TTL_MS || now >= record.expiresAt) {
    await transition(i.wallet, i.id, ["creating"], { state: "failed", error: "The prepared deposit expired before it was submitted." }, now);
    return fail(410, "expired", "That took too long — start the strategy again.");
  }

  try {
    const order = await deps.jupiter.createOrder(orderParamsFor(record, i.depositSignedTx), i.token);
    let live = await transition(i.wallet, i.id, ["creating"], { state: "waiting", jupiterOrderId: order.id }, deps.now());
    // The strategy exists: now, and only now, the fee is collected (so nothing is charged if Jupiter refused the order).
    if (record.feeLamports > 0) {
      try {
        const signature = await deps.fee.send(i.feeSignedTx as string);
        live = (await transition(i.wallet, i.id, ["waiting"], { feeState: "paid", feeSignature: signature }, deps.now())) ?? live;
      } catch (err) {
        live = (await transition(i.wallet, i.id, ["waiting"], { feeState: "failed", feeError: clip(err) }, deps.now())) ?? live;
      }
    }
    return { ok: true, record: live ?? record };
  } catch (err) {
    const message = clip(err);
    await transition(i.wallet, i.id, ["creating"], { state: "failed", error: message }, deps.now());
    return fail(502, "jupiter_error", message);
  }
}

/** Reads back what Jupiter did with each live strategy and advances it — only on facts, never backwards. */
export async function syncStrategies(deps: Deps, i: { wallet: string; token: string }): Promise<Failure | { ok: true; strategies: StrategyRecord[] }> {
  if (!deps.engineConfigured()) return fail(503, "engine_unavailable", "The order engine isn't configured on this deployment.");
  const now = deps.now();
  const all = await listStrategies(i.wallet, now);
  const live = all.filter((s) => s.jupiterOrderId && !TERMINAL.includes(s.state));
  if (live.length === 0) return { ok: true, strategies: all };

  let orders: TriggerOrder[];
  try {
    const [active, past] = await Promise.all([
      deps.jupiter.listOrders(i.token, { state: "active", limit: 100 }),
      deps.jupiter.listOrders(i.token, { state: "past", limit: 100 }),
    ]);
    orders = [...active.orders, ...past.orders];
  } catch (err) {
    return fail(502, "jupiter_error", clip(err));
  }

  for (const s of live) {
    const order = orders.find((o) => o.id === s.jupiterOrderId);
    if (!order) {
      await transition(i.wallet, s.id, [s.state], { lastSyncAt: now }, now);
      continue;
    }
    const d = await deriveStatus(order, deps.verifyTx, s.kind);
    if (d.status && canAdvance(s.state, d.status)) {
      await transition(
        i.wallet,
        s.id,
        [s.state],
        {
          state: d.status,
          lastSyncAt: now,
          ...(d.buySignature ? { buySignature: d.buySignature } : {}),
          ...(d.sellSignature ? { sellSignature: d.sellSignature, sellKind: d.sellKind } : {}),
          ...(d.holdsTokens ? { holdsTokens: true } : {}),
        },
        now
      );
    } else {
      await transition(i.wallet, s.id, [s.state], { lastSyncAt: now }, now);
    }
  }
  return { ok: true, strategies: await listStrategies(i.wallet, now) };
}

/** Jupiter's create-order request for a stored strategy. Records from before shapes existed are the full otoco. */
function orderParamsFor(record: StrategyRecord, depositSignedTx: string): CreateOrderParams {
  const kind = record.kind ?? "buy_sell_stop";
  if (kind !== "buy_sell_stop") {
    return jupiterOrderParams(kind, {
      wallet: record.wallet,
      mint: record.mint,
      settlementMint: record.fundingMint,
      fundingMint: record.fundingMint,
      inputAmountRaw: record.inputAmountRaw,
      legs: { buy: record.buyUsd, sell: record.sellUsd, stop: record.stopUsd },
      buyCondition: record.triggerCondition,
      depositRequestId: record.depositRequestId,
      depositSignedTx,
      expiresAt: record.expiresAt,
    });
  }
  return {
    orderType: "otoco",
    depositRequestId: record.depositRequestId,
    depositSignedTx,
    userPubkey: record.wallet,
    inputMint: record.fundingMint,
    inputAmount: record.inputAmountRaw,
    outputMint: record.mint,
    triggerMint: record.mint,
    triggerCondition: record.triggerCondition as "above" | "below",
    triggerPriceUsd: record.buyUsd,
    tpPriceUsd: record.sellUsd,
    slPriceUsd: record.stopUsd,
    slippageBps: BUY_SLIPPAGE_BPS,
    tpSlippageBps: TP_SLIPPAGE_BPS,
    slSlippageBps: SL_SLIPPAGE_BPS,
    expiresAt: record.expiresAt,
  };
}

/**
 * The shapes other than the full strategy: a single buy, a single sell or stop of a held token, or an oco pair on
 * held tokens. Validated BEFORE the deposit is asked for, so nothing is crafted for an order that would be refused.
 * For held tokens the sold amount is re-read from the wallet's balance here, never taken from the browser.
 */
async function prepareShape(
  deps: Deps,
  i: { wallet: string; token: string; id: string; n: number; mint: string; ticker: string; kind: OrderKind; legs: Legs; unit: AmountUnit; value: number; sellPct: unknown; preferred: FundingAsset | null },
  quote: StrategyQuote,
  tradeFeeBps: number
): Promise<Failure | { ok: true; record: StrategyRecord; transaction: string; feeTransaction: string | null }> {
  if (!quote.tokenUsd) return fail(503, "price_unavailable", "No live price for this token right now.");
  const holds = !startsWithBuy(i.kind);
  let amountUsd: number;
  let fundingAsset: FundingAsset;
  let inputMint: string;
  let inputAmountRaw: string;
  let orderSubType: "single" | "oco";
  let sellPct: number | undefined;
  let issues: KindIssue[];

  if (!holds) {
    const funding = chooseFunding({ unit: i.unit, value: i.value, rates: quote, balances: { sol: null, usdc: null }, preferred: i.preferred, feeBps: strategyFeeBps(tradeFeeBps) });
    if (!funding.ok) {
      return fail(funding.reason === "invalid_amount" ? 400 : 503, funding.reason === "invalid_amount" ? "invalid" : "price_unavailable", "That amount can't be converted right now.");
    }
    amountUsd = funding.funding.usd;
    fundingAsset = funding.funding.asset;
    inputMint = funding.funding.mint;
    inputAmountRaw = funding.funding.raw;
    orderSubType = "single";
    issues = validateKind(i.kind, i.legs, { currentUsd: quote.tokenUsd, amountUsd, liquidityUsd: quote.liquidityUsd });
  } else {
    const pct = typeof i.sellPct === "number" ? i.sellPct : NaN;
    if (!(pct >= 1 && pct <= 100)) return fail(400, "invalid", "Choose a percentage between 1 and 100.");
    sellPct = pct;
    let balance: { raw: bigint; decimals: number };
    try {
      balance = await deps.balance(i.wallet, i.mint);
    } catch (err) {
      return fail(502, "jupiter_error", clip(err));
    }
    const tokensRaw = sellAmountRaw(balance.raw, pct);
    amountUsd = (Number(tokensRaw) / 10 ** balance.decimals) * quote.tokenUsd;
    fundingAsset = i.preferred ?? "USDC";
    inputMint = i.mint;
    inputAmountRaw = tokensRaw.toString();
    orderSubType = ORDER_TYPE[i.kind] === "oco" ? "oco" : "single";
    issues = validateKind(i.kind, i.legs, { currentUsd: quote.tokenUsd, tokensUsd: amountUsd, liquidityUsd: quote.liquidityUsd });
  }
  if (issues.length) return fail(422, "issues", "This strategy can't be placed as drawn.", issues);

  let fee = strategyFee(amountUsd, quote.solUsd, tradeFeeBps);
  if (!fee) return fail(503, "price_unavailable", "No live SOL rate to work out the fee right now.");
  if (fee.feeLamports <= 0) return fail(400, "invalid", "That amount is too small.");
  if (!(await deps.fee.canReceive(fee.feeLamports))) fee = { feeUsd: 0, feeLamports: 0 };

  let deposit: DepositCraft;
  try {
    deposit = await deps.jupiter.craftDeposit(
      { inputMint, outputMint: holds ? FUNDING[fundingAsset].mint : i.mint, userAddress: i.wallet, amount: inputAmountRaw, orderType: "price", orderSubType },
      i.token
    );
  } catch (err) {
    return fail(502, "jupiter_error", clip(err));
  }
  let feeTransaction: string | null = null;
  try {
    feeTransaction = fee.feeLamports > 0 ? await deps.fee.build(i.wallet, fee.feeLamports) : null;
  } catch (err) {
    return fail(502, "jupiter_error", clip(err));
  }

  const now = deps.now();
  const record: StrategyRecord = {
    id: i.id,
    n: i.n,
    wallet: i.wallet,
    mint: i.mint,
    ticker: i.ticker,
    kind: i.kind,
    ...(i.legs.buy !== undefined ? { buyUsd: i.legs.buy, triggerCondition: triggerConditionFor(i.legs.buy, quote.tokenUsd) } : {}),
    ...(i.legs.sell !== undefined ? { sellUsd: i.legs.sell } : {}),
    ...(i.legs.stop !== undefined ? { stopUsd: i.legs.stop } : {}),
    ...(sellPct !== undefined ? { sellPct } : {}),
    fundingAsset,
    fundingMint: holds ? FUNDING[fundingAsset].mint : inputMint,
    inputAmountRaw,
    amountUsd,
    feeLamports: fee.feeLamports,
    feeState: fee.feeLamports > 0 ? "prepared" : "none",
    state: "prepared",
    depositRequestId: deposit.requestId,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + STRATEGY_TTL_MS,
  };
  const put = await putPrepared(record, now);
  if (!put.ok) {
    if (put.reason === "exists") return fail(409, "conflict", "This strategy was already submitted.");
    return fail(429, "limit", put.reason === "limit" ? "Too many strategies on this wallet." : "Too many strategies waiting to be confirmed.");
  }
  return { ok: true, record, transaction: deposit.transaction, feeTransaction };
}

function clip(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 300 ? `${m.slice(0, 300)}…` : m;
}
