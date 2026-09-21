import { PublicKey } from "@solana/web3.js";
import type { CreateOrderParams, DepositCraft, TriggerOrder } from "@/lib/jupiter/trigger";
import {
  amountToUsd,
  BUY_SLIPPAGE_BPS,
  chooseFunding,
  SL_SLIPPAGE_BPS,
  STRATEGY_TTL_MS,
  TP_SLIPPAGE_BPS,
  triggerConditionFor,
  validateStrategy,
  type AmountUnit,
  type FundingAsset,
  type StrategyIssue,
} from "./plan";
import { deriveStatus, canAdvance } from "./status";
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
};

export type Failure = {
  ok: false;
  status: number;
  code: "engine_unavailable" | "invalid" | "price_unavailable" | "issues" | "conflict" | "limit" | "expired" | "jupiter_error" | "not_found";
  message: string;
  issues?: StrategyIssue[];
};
const fail = (status: number, code: Failure["code"], message: string, issues?: StrategyIssue[]): Failure => ({ ok: false, status, code, message, issues });

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
};

export async function prepareStrategy(deps: Deps, i: PrepareInput): Promise<Failure | { ok: true; record: StrategyRecord; transaction: string }> {
  if (!deps.engineConfigured()) return fail(503, "engine_unavailable", "The order engine isn't configured on this deployment.");
  const { id, n, mint, buyUsd, sellUsd, stopUsd } = i;
  const unit = i.amount.unit as AmountUnit;
  const value = Number(i.amount.value);
  if (typeof id !== "string" || !ID_RE.test(id)) return fail(400, "invalid", "Invalid strategy id.");
  if (!validKey(i.wallet) || !validKey(mint)) return fail(400, "invalid", "Invalid wallet or token address.");
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 999) return fail(400, "invalid", "Invalid strategy number.");
  if (![buyUsd, sellUsd, stopUsd].every((p) => typeof p === "number" && Number.isFinite(p) && p > 0)) return fail(400, "invalid", "Invalid target prices.");
  if (!["USD", "EUR", "SOL", "USDC"].includes(unit)) return fail(400, "invalid", "Invalid amount unit.");
  const preferred = i.fundingAsset === "SOL" || i.fundingAsset === "USDC" ? (i.fundingAsset as FundingAsset) : null;
  const ticker = typeof i.ticker === "string" && /^[\w.$-]{1,16}$/.test(i.ticker) ? i.ticker : "?";

  // Every number that matters is re-read here; nothing the browser computed is trusted.
  const quote = await deps.quote(mint as string);
  if (!quote.tokenUsd) return fail(503, "price_unavailable", "No live price for this token right now.");
  const amountUsd = amountToUsd(unit, value, quote);
  const funding = chooseFunding({ unit, value, rates: quote, balances: { sol: null, usdc: null }, preferred });
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
    fundingAsset: funding.funding.asset,
    fundingMint: funding.funding.mint,
    inputAmountRaw: funding.funding.raw,
    amountUsd: funding.funding.usd,
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
  return { ok: true, record, transaction: deposit.transaction };
}

export async function createStrategy(
  deps: Deps,
  i: { wallet: string; token: string; id: unknown; depositSignedTx: unknown }
): Promise<Failure | { ok: true; record: StrategyRecord }> {
  if (!deps.engineConfigured()) return fail(503, "engine_unavailable", "The order engine isn't configured on this deployment.");
  if (typeof i.id !== "string" || !ID_RE.test(i.id)) return fail(400, "invalid", "Invalid strategy id.");
  if (typeof i.depositSignedTx !== "string" || i.depositSignedTx.length < 100 || i.depositSignedTx.length > 20_000) return fail(400, "invalid", "Missing signed deposit.");
  const now = deps.now();

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
    const order = await deps.jupiter.createOrder(
      {
        orderType: "otoco",
        depositRequestId: record.depositRequestId,
        depositSignedTx: i.depositSignedTx,
        userPubkey: record.wallet,
        inputMint: record.fundingMint,
        inputAmount: record.inputAmountRaw,
        outputMint: record.mint,
        triggerMint: record.mint,
        triggerCondition: record.triggerCondition,
        triggerPriceUsd: record.buyUsd,
        tpPriceUsd: record.sellUsd,
        slPriceUsd: record.stopUsd,
        slippageBps: BUY_SLIPPAGE_BPS,
        tpSlippageBps: TP_SLIPPAGE_BPS,
        slSlippageBps: SL_SLIPPAGE_BPS,
        expiresAt: record.expiresAt,
      },
      i.token
    );
    const live = await transition(i.wallet, i.id, ["creating"], { state: "waiting", jupiterOrderId: order.id }, deps.now());
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
    const d = await deriveStatus(order, deps.verifyTx);
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

function clip(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 300 ? `${m.slice(0, 300)}…` : m;
}
