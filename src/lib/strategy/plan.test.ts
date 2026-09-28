import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountToUsd,
  chooseFunding,
  convertAmount,
  defaultStop,
  MIN_ORDER_USD,
  preferredFunding,
  roundPrice,
  strategyFee,
  STRATEGY_FEE_BPS,
  strategyMetrics,
  triggerConditionFor,
  validateStrategy,
  validateSellPcts,
  trancheDollarIssues,
  maxTranchesFor,
  pctVsBuy,
  MAX_TRANCHES,
  MIN_TRANCHE_USD,
  type Rates,
} from "./plan";

const rates: Rates = { solUsd: 200, usdcUsd: 1, eurUsd: 1.1 };

test("BUY target below the price is a 'below' trigger, above it an 'above' trigger", () => {
  assert.equal(triggerConditionFor(0.9, 1), "below");
  assert.equal(triggerConditionFor(1.2, 1), "above");
});

test("prices are rounded to 4 significant digits, never to zero", () => {
  assert.equal(roundPrice(0.000012345678), 0.00001235);
  assert.equal(roundPrice(123.456789), 123.5);
  assert.equal(roundPrice(0), 0);
  assert.equal(roundPrice(NaN), 0);
  assert.equal(defaultStop(1), 0.8);
});

test("a valid strategy has no issues", () => {
  assert.deepEqual(validateStrategy({ buy: 0.9, sell: 1.4, stop: 0.7, amountUsd: 50, currentUsd: 1, liquidityUsd: 100_000 }), []);
});

test("SELL must be above BUY and the stop below it", () => {
  assert.deepEqual(validateStrategy({ buy: 1, sell: 0.9, stop: 0.8, amountUsd: 50, currentUsd: 1.2 }), ["sell_not_above_buy"]);
  assert.deepEqual(validateStrategy({ buy: 1, sell: 1.5, stop: 1.1, amountUsd: 50, currentUsd: 1.2 }), ["stop_not_below_buy"]);
  assert.deepEqual(validateStrategy({ buy: 1, sell: 1, stop: 0.5, amountUsd: 50, currentUsd: 1.2 }), ["sell_not_above_buy"]);
});

test("bad numbers, tiny orders and orders too close to the market are refused", () => {
  assert.deepEqual(validateStrategy({ buy: NaN, sell: 1, stop: 1, amountUsd: 50, currentUsd: 1 }), ["invalid_price"]);
  assert.deepEqual(validateStrategy({ buy: -1, sell: 1, stop: 1, amountUsd: 50, currentUsd: 1 }), ["invalid_price"]);
  assert.ok(validateStrategy({ buy: 0.9, sell: 1.4, stop: 0.7, amountUsd: MIN_ORDER_USD - 0.01, currentUsd: 1 }).includes("below_minimum"));
  assert.ok(validateStrategy({ buy: 0.9995, sell: 1.4, stop: 0.7, amountUsd: 50, currentUsd: 1 }).includes("buy_too_close"));
  assert.ok(validateStrategy({ buy: 0.9, sell: 5000, stop: 0.7, amountUsd: 50, currentUsd: 1 }).includes("too_far"));
  assert.ok(validateStrategy({ buy: 0.9, sell: 1.4, stop: 0.7, amountUsd: 50, currentUsd: null }).includes("price_unavailable"));
});

test("liquidity: unknown is refused, tiny is refused, an order too big for the pool is refused, undefined skips the check", () => {
  const base = { buy: 0.9, sell: 1.4, stop: 0.7, currentUsd: 1 };
  assert.ok(validateStrategy({ ...base, amountUsd: 50, liquidityUsd: null }).includes("liquidity_unknown"));
  assert.ok(validateStrategy({ ...base, amountUsd: 50, liquidityUsd: 100 }).includes("liquidity_low"));
  assert.ok(validateStrategy({ ...base, amountUsd: 5_000, liquidityUsd: 20_000 }).includes("too_large_for_pool"));
  assert.deepEqual(validateStrategy({ ...base, amountUsd: 50 }), []);
});

test("metrics: difference, percentage, gross return, stop loss and worst case", () => {
  const m = strategyMetrics({ buy: 1.2, sell: 1.8, stop: 0.96, amountUsd: 120 });
  assert.equal(Math.round(m.diff * 100) / 100, 0.6);
  assert.equal(Math.round(m.pct * 100) / 100, 50);
  assert.equal(Math.round(m.tokens), 100);
  assert.equal(Math.round(m.grossReturnUsd * 100) / 100, 180);
  assert.equal(Math.round(m.grossProfitUsd * 100) / 100, 60);
  assert.equal(Math.round(m.stopLossUsd * 100) / 100, -24);
  assert.equal(Math.round(m.stopLossPct * 100) / 100, -20);
  // Full slippage on both legs (5% on the buy, 5% on the take-profit) must be worse than the exact figure.
  assert.ok(m.worstCaseProfitUsd < m.grossProfitUsd);
  assert.equal(Math.round(m.worstCaseProfitUsd * 100) / 100, Math.round(((120 / (1.2 * 1.05)) * 1.8 * 0.95 - 120) * 100) / 100);
});

test("USD and EUR are reference units: converted with real rates, unavailable when a rate is missing", () => {
  assert.equal(amountToUsd("USD", 100, rates), 100);
  assert.ok(Math.abs((amountToUsd("EUR", 100, rates) ?? 0) - 110) < 1e-9);
  assert.equal(amountToUsd("SOL", 0.5, rates), 100);
  assert.equal(amountToUsd("USDC", 100, { ...rates, usdcUsd: 0.999 }), 99.9);
  assert.equal(amountToUsd("EUR", 100, { ...rates, eurUsd: null }), null);
  assert.equal(amountToUsd("SOL", 1, { ...rates, solUsd: null }), null);
  assert.equal(amountToUsd("USD", 0, rates), null);
  assert.equal(amountToUsd("USD", NaN, rates), null);
});

test("100 EUR is paid in the coin the wallet holds most of: SOL when SOL is bigger", () => {
  const r = chooseFunding({ unit: "EUR", value: 100, rates, balances: { sol: 5, usdc: 20 } });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.funding.asset, "SOL");
  assert.ok(Math.abs(r.funding.usd - 110) < 1e-9);
  assert.ok(Math.abs(r.funding.ui - 0.55) < 1e-9); // 110 USD / 200 USD per SOL
  assert.equal(r.funding.raw, "550000000");
});

test("...and USDC when USDC is bigger", () => {
  const r = chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: 0.3, usdc: 900 } });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.funding.asset, "USDC");
  assert.equal(r.funding.ui, 100);
  assert.equal(r.funding.raw, "100000000");
});

test("if the bigger holding can't cover it but the other can, the other pays", () => {
  // SOL is worth more but leaves too little after the fee cushion; USDC covers it.
  const r = chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: 0.5, usdc: 150 } });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.funding.asset, "USDC");
});

test("SOL and USDC typed as the unit force that coin; the user's own pick wins for USD/EUR", () => {
  const sol = chooseFunding({ unit: "SOL", value: 0.25, rates, balances: { sol: 3, usdc: 5000 } });
  assert.ok(sol.ok && sol.funding.asset === "SOL" && sol.funding.raw === "250000000" && sol.funding.usd === 50);
  const usdc = chooseFunding({ unit: "USDC", value: 40, rates, balances: { sol: 30, usdc: 100 } });
  assert.ok(usdc.ok && usdc.funding.asset === "USDC" && usdc.funding.raw === "40000000");
  const picked = chooseFunding({ unit: "USD", value: 50, rates, balances: { sol: 30, usdc: 100 }, preferred: "USDC" });
  assert.ok(picked.ok && picked.funding.asset === "USDC");
});

test("not enough of any coin says how much is missing", () => {
  const r = chooseFunding({ unit: "USD", value: 500, rates, balances: { sol: 0.5, usdc: 10 } });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "insufficient");
  assert.ok((r.shortfallUsd ?? 0) > 0);
  const forced = chooseFunding({ unit: "SOL", value: 2, rates, balances: { sol: 1, usdc: 0 } });
  assert.equal(forced.ok, false);
});

test("a missing rate never becomes a guess", () => {
  assert.deepEqual(chooseFunding({ unit: "EUR", value: 10, rates: { ...rates, eurUsd: null }, balances: { sol: 5, usdc: 5 } }), { ok: false, reason: "price_unavailable" });
  assert.deepEqual(chooseFunding({ unit: "SOL", value: 1, rates: { ...rates, solUsd: null }, balances: { sol: 5, usdc: 5 } }), { ok: false, reason: "price_unavailable" });
  assert.deepEqual(chooseFunding({ unit: "USD", value: 0, rates, balances: { sol: 5, usdc: 5 } }), { ok: false, reason: "invalid_amount" });
});

test("with balances unknown it defaults to SOL and says the balance isn't known", () => {
  const r = chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: null, usdc: null } });
  assert.ok(r.ok && r.funding.asset === "SOL" && r.funding.balanceKnown === false);
});

test("the coin to pay with by default is the one the wallet holds most of; SOL when nothing is known", () => {
  assert.equal(preferredFunding({ sol: 5, usdc: 20 }, rates), "SOL");
  assert.equal(preferredFunding({ sol: 0.3, usdc: 900 }, rates), "USDC");
  assert.equal(preferredFunding({ sol: 0.005, usdc: 3 }, rates), "USDC"); // SOL is only the fee cushion
  assert.equal(preferredFunding({ sol: null, usdc: null }, rates), "SOL");
  assert.equal(preferredFunding({ sol: null, usdc: 50 }, rates), "USDC");
});

test("an amount can be shown in another unit with the real rates, and not at all without them", () => {
  assert.equal(convertAmount("USD", 100, "SOL", rates), 0.5);
  assert.ok(Math.abs((convertAmount("EUR", 100, "USD", rates) ?? 0) - 110) < 1e-9);
  assert.ok(Math.abs((convertAmount("SOL", 0.55, "EUR", rates) ?? 0) - 100) < 1e-9);
  assert.equal(convertAmount("USD", 100, "EUR", { ...rates, eurUsd: null }), null);
  assert.equal(convertAmount("USD", 0, "SOL", rates), null);
});

test("PANDA's strategy fee is 1% of the amount (0.5% buy + 0.5% sell), worked out in SOL", () => {
  assert.equal(STRATEGY_FEE_BPS, 100);
  assert.deepEqual(strategyFee(100, 200), { feeUsd: 1, feeLamports: 5_000_000 });
  assert.equal(strategyFee(100, null), null);
  assert.equal(strategyFee(0, 200), null);
});

test("the fee is paid in SOL on top of the amount: the wallet has to cover both", () => {
  // 100 USD paid in SOL: 101 USD of SOL are needed.
  const short = chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: 0.5, usdc: 0 }, preferred: "SOL", feeBps: 100 });
  assert.equal(short.ok, false); // 0.5 SOL = 100 USD, minus the cushion, is not enough for 101
  const enough = chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: 0.52, usdc: 0 }, preferred: "SOL", feeBps: 100 });
  assert.ok(enough.ok && Math.abs(enough.funding.feeUsd - 1) < 1e-9);
  // Paid in USDC: the amount comes from USDC, the fee still needs SOL.
  const noSol = chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: 0.006, usdc: 500 }, preferred: "USDC", feeBps: 100 });
  assert.equal(noSol.ok, false);
  const withSol = chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: 0.02, usdc: 500 }, preferred: "USDC", feeBps: 100 });
  assert.ok(withSol.ok);
  // Without a fee asked for, nothing changes.
  assert.ok(chooseFunding({ unit: "USD", value: 100, rates, balances: { sol: 0.52, usdc: 0 }, preferred: "SOL" }).ok);
});

test("the result shown to the user is after PANDA's fee", () => {
  const m = strategyMetrics({ buy: 1, sell: 1.5, stop: 0.8, amountUsd: 100, feeUsd: 1 });
  assert.equal(Math.round(m.grossProfitUsd), 50);
  assert.equal(Math.round(m.netProfitUsd * 100) / 100, 49);
  assert.equal(Math.round(m.netStopLossUsd * 100) / 100, -21);
  assert.equal(strategyMetrics({ buy: 1, sell: 1.5, stop: 0.8, amountUsd: 100 }).netProfitUsd, 50); // no fee asked: unchanged
});

test("validateSellPcts: 1 to 10 tranches, summing to exactly 100", () => {
  assert.deepEqual(validateSellPcts([{ pct: 100 }]), []);
  assert.deepEqual(validateSellPcts([{ pct: 50 }, { pct: 30 }, { pct: 20 }]), []);
  assert.equal(MAX_TRANCHES, 10);
  assert.deepEqual(validateSellPcts([]), ["too_many_sells", "sells_pct_invalid"]); // 0 tranches: too few, and they sum to 0
  assert.deepEqual(
    validateSellPcts(Array.from({ length: 11 }, () => ({ pct: 100 / 11 }))),
    ["too_many_sells"]
  ); // 11 tranches
  assert.deepEqual(
    validateSellPcts(Array.from({ length: 10 }, () => ({ pct: 10 }))),
    []
  ); // exactly 10 is fine
  assert.deepEqual(validateSellPcts([{ pct: 50 }, { pct: 30 }]), ["sells_pct_invalid"]); // sums to 80
  assert.deepEqual(validateSellPcts([{ pct: 60 }, { pct: 50 }]), ["sells_pct_invalid"]); // sums to 110
  // Rounding: 33.33 + 33.33 + 33.34 is "close enough" to 100 once rounded.
  assert.deepEqual(validateSellPcts([{ pct: 33.33 }, { pct: 33.33 }, { pct: 33.34 }]), []);
});

test("maxTranchesFor: one tranche per MIN_TRANCHE_USD of the amount, capped at MAX_TRANCHES", () => {
  assert.equal(MIN_TRANCHE_USD, 11);
  assert.equal(maxTranchesFor(null), 1);
  assert.equal(maxTranchesFor(10), 1); // below one tranche's own minimum
  assert.equal(maxTranchesFor(11), 1);
  assert.equal(maxTranchesFor(33), 3);
  assert.equal(maxTranchesFor(66), 6);
  assert.equal(maxTranchesFor(110), 10);
  assert.equal(maxTranchesFor(1_000_000), 10); // capped
});

test("trancheDollarIssues: flags a tranche whose own share is under MIN_TRANCHE_USD, only with more than one tranche", () => {
  assert.deepEqual(trancheDollarIssues([{ pct: 100 }], 5), [false]); // a single tranche uses the plain below_minimum check instead
  assert.deepEqual(trancheDollarIssues([{ pct: 50 }, { pct: 50 }], 100), [false, false]); // 50 & 50, both clear 11
  assert.deepEqual(trancheDollarIssues([{ pct: 90 }, { pct: 10 }], 100), [false, true]); // 90 & 10 -> $10 fails
  assert.deepEqual(trancheDollarIssues([{ pct: 50 }, { pct: 50 }], null), [false, false]); // can't tell yet
});

test("pctVsBuy: the live % a price sits from the buy target", () => {
  assert.ok(Math.abs(pctVsBuy(1.21, 1)! - 21) < 1e-9);
  assert.ok(Math.abs(pctVsBuy(0.84, 1)! - -16) < 1e-9);
  assert.equal(pctVsBuy(1, undefined), null);
  assert.equal(pctVsBuy(1, 0), null);
});
