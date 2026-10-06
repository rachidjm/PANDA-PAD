import { test } from "node:test";
import assert from "node:assert/strict";
import { jupiterOrderParams, kindOf, ORDER_TYPE, sellAmountRaw, validateKind, type Legs } from "./kinds";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const cur = 0.001;
const ctx = { currentUsd: cur, amountUsd: 50, tokensUsd: 50, liquidityUsd: 200_000 };

// ── Which shape a set of legs is ──────────────────────────────────────────────────────────────────────────────

test("kindOf: every offered combination maps to its own shape", () => {
  assert.equal(kindOf({ buy: 0.0012 }), "buy");
  assert.equal(kindOf({ sell: 0.002 }), "sell");
  assert.equal(kindOf({ stop: 0.0008 }), "stop");
  assert.equal(kindOf({ sell: 0.002, stop: 0.0008 }), "sell_stop");
  assert.equal(kindOf({ buy: 0.0012, sell: 0.002, stop: 0.0008 }), "buy_sell_stop");
});

test("kindOf: buy + sell and buy + stop are NOT offered (no native Jupiter order)", () => {
  assert.equal(kindOf({ buy: 0.0012, sell: 0.002 }), null);
  assert.equal(kindOf({ buy: 0.0012, stop: 0.0008 }), null);
});

test("kindOf: no legs at all is not a strategy", () => {
  assert.equal(kindOf({}), null);
});

test("ORDER_TYPE: single for the one-leg shapes, oco for sell + stop, otoco for the full strategy", () => {
  assert.equal(ORDER_TYPE.buy, "single");
  assert.equal(ORDER_TYPE.sell, "single");
  assert.equal(ORDER_TYPE.stop, "single");
  assert.equal(ORDER_TYPE.sell_stop, "oco");
  assert.equal(ORDER_TYPE.buy_sell_stop, "otoco");
});

// ── Validation per shape ───────────────────────────────────────────────────────────────────────────────────────

test("validateKind buy: a buy target away from the price with enough size is valid", () => {
  assert.deepEqual(validateKind("buy", { buy: 0.0008 }, ctx), []);
});

test("validateKind buy: a buy target that is the current price is rejected (a market buy, not a target)", () => {
  assert.ok(validateKind("buy", { buy: cur * 1.0001 }, ctx).includes("buy_too_close"));
});

test("validateKind buy: under the $10 minimum is rejected", () => {
  assert.ok(validateKind("buy", { buy: 0.0008 }, { ...ctx, amountUsd: 9.99 }).includes("below_minimum"));
});

test("validateKind sell: a sell target must be above the current price", () => {
  assert.deepEqual(validateKind("sell", { sell: 0.002 }, ctx), []);
  assert.ok(validateKind("sell", { sell: 0.0005 }, ctx).includes("sell_not_above_current"));
});

test("validateKind sell: a held balance worth under $10 is rejected, and no balance is its own reason", () => {
  assert.ok(validateKind("sell", { sell: 0.002 }, { ...ctx, tokensUsd: 9 }).includes("below_minimum"));
  assert.ok(validateKind("sell", { sell: 0.002 }, { ...ctx, tokensUsd: 0 }).includes("no_balance"));
});

test("validateKind stop: a stop must be below the current price", () => {
  assert.deepEqual(validateKind("stop", { stop: 0.0008 }, ctx), []);
  assert.ok(validateKind("stop", { stop: 0.002 }, ctx).includes("stop_not_below_current"));
});

test("validateKind sell_stop: take-profit above the price, stop below it, and take-profit above the stop", () => {
  assert.deepEqual(validateKind("sell_stop", { sell: 0.002, stop: 0.0008 }, ctx), []);
  assert.ok(validateKind("sell_stop", { sell: 0.0005, stop: 0.0008 }, ctx).includes("sell_not_above_current"));
  assert.ok(validateKind("sell_stop", { sell: 0.002, stop: 0.002 }, ctx).includes("tp_not_above_stop"));
});

test("validateKind: a missing or dead price feed is refused before anything else", () => {
  assert.deepEqual(validateKind("sell", { sell: 0.002 }, { ...ctx, currentUsd: null }), ["price_unavailable"]);
});

test("validateKind: low or unknown liquidity blocks any shape, the same way it does for buys", () => {
  assert.ok(validateKind("stop", { stop: 0.0008 }, { ...ctx, liquidityUsd: 1000 }).includes("liquidity_low"));
  assert.ok(validateKind("stop", { stop: 0.0008 }, { ...ctx, liquidityUsd: null }).includes("liquidity_unknown"));
});

test("validateKind buy_sell_stop still uses the existing strategy rules unchanged", () => {
  assert.deepEqual(validateKind("buy_sell_stop", { buy: 0.0008, sell: 0.002, stop: 0.0005 }, ctx), []);
  assert.ok(validateKind("buy_sell_stop", { buy: 0.0008, sell: 0.0005, stop: 0.0004 }, ctx).includes("sell_not_above_buy"));
});

// ── Percentages of a held balance ──────────────────────────────────────────────────────────────────────────────

test("sellAmountRaw: a percentage of the balance, rounded down to whole raw units", () => {
  assert.equal(sellAmountRaw(BigInt("1000000"), 25), BigInt("250000"));
  assert.equal(sellAmountRaw(BigInt("1000000"), 100), BigInt("1000000"));
  assert.equal(sellAmountRaw(BigInt("1000000"), 33.3), BigInt("333000"));
  assert.equal(sellAmountRaw(BigInt("3"), 50), BigInt("1"), "3 × 50% = 1.5, rounded down");
});

test("sellAmountRaw: nothing to sell for zero, over 100%, or an empty balance", () => {
  assert.equal(sellAmountRaw(BigInt("1000000"), 0), BigInt("0"));
  assert.equal(sellAmountRaw(BigInt("1000000"), 101), BigInt("0"));
  assert.equal(sellAmountRaw(BigInt("0"), 50), BigInt("0"));
});

// ── Jupiter request fields ─────────────────────────────────────────────────────────────────────────────────────

const common = { wallet: "W", mint: MINT, settlementMint: USDC, fundingMint: SOL, inputAmountRaw: "1000", depositRequestId: "req", depositSignedTx: "signed", expiresAt: 9 };

test("jupiterOrderParams buy: a single buy from the funding asset into the token, triggered when the price reaches the buy", () => {
  const p = jupiterOrderParams("buy", { ...common, legs: { buy: 0.0008 }, buyCondition: "below" });
  assert.equal(p.orderType, "single");
  assert.equal(p.inputMint, SOL);
  assert.equal(p.outputMint, MINT);
  assert.equal(p.triggerMint, MINT);
  assert.equal(p.triggerCondition, "below");
  assert.equal(p.triggerPriceUsd, 0.0008);
});

test("jupiterOrderParams sell: a single sell of the held token, triggered above the sell target", () => {
  const p = jupiterOrderParams("sell", { ...common, legs: { sell: 0.002 } });
  assert.equal(p.orderType, "single");
  assert.equal(p.inputMint, MINT);
  assert.equal(p.outputMint, USDC);
  assert.equal(p.inputAmount, "1000");
  assert.equal(p.triggerCondition, "above");
  assert.equal(p.triggerPriceUsd, 0.002);
});

test("jupiterOrderParams stop: a single sell of the held token, triggered below the stop", () => {
  const p = jupiterOrderParams("stop", { ...common, legs: { stop: 0.0008 } });
  assert.equal(p.orderType, "single");
  assert.equal(p.triggerCondition, "below");
  assert.equal(p.triggerPriceUsd, 0.0008);
});

test("jupiterOrderParams sell_stop: one oco on one deposit of the held token, with both take-profit and stop-loss", () => {
  const p = jupiterOrderParams("sell_stop", { ...common, legs: { sell: 0.002, stop: 0.0008 } });
  assert.equal(p.orderType, "oco");
  assert.equal(p.inputMint, MINT);
  assert.equal(p.tpPriceUsd, 0.002);
  assert.equal(p.slPriceUsd, 0.0008);
  assert.ok(p.tpSlippageBps !== undefined && p.slSlippageBps !== undefined);
});

test("jupiterOrderParams: the full strategy has no shape of its own here (service.ts builds the otoco)", () => {
  assert.throws(() => jupiterOrderParams("buy_sell_stop", { ...common, legs: { buy: 1, sell: 2, stop: 0.5 }, buyCondition: "below" }));
});

test("every shape is accepted only with its own legs — a mismatched combination never maps to an order", () => {
  const legs: Legs = { buy: 0.0012, sell: 0.002 };
  assert.equal(kindOf(legs), null);
});
