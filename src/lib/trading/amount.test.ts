import { test } from "node:test";
import assert from "node:assert/strict";
import { maxInUnit, solToUnit, unitToSol, type BuyRates } from "./amount";

const rates: BuyRates = { solUsd: 200, eurUsd: 1.1 };

test("SOL is used as typed; USD and EUR are converted with the real rates", () => {
  assert.equal(unitToSol("SOL", 0.5, rates), 0.5);
  assert.equal(unitToSol("USD", 100, rates), 0.5);
  assert.equal(unitToSol("EUR", 100, rates), 0.55); // 100 EUR = 110 USD = 0.55 SOL
});

test("a missing rate disables that unit instead of guessing", () => {
  assert.equal(unitToSol("USD", 10, { solUsd: null, eurUsd: 1.1 }), null);
  assert.equal(unitToSol("EUR", 10, { solUsd: 200, eurUsd: null }), null);
  assert.equal(unitToSol("USD", 10, { solUsd: 200, eurUsd: null }), 0.05); // USD doesn't need the euro rate
  assert.equal(unitToSol("SOL", 1, { solUsd: null, eurUsd: null }), 1); // SOL needs no rate
});

test("nothing typed, zero and junk mean nothing to spend", () => {
  for (const v of [0, -5, NaN, Infinity]) assert.equal(unitToSol("USD", v, rates), 0);
});

test("the SOL asked for is never more than what was typed (rounded down)", () => {
  const r: BuyRates = { solUsd: 119.3, eurUsd: 1.149 };
  for (const v of [1, 7.77, 10, 33.33, 99.99, 1234.56]) {
    const sol = unitToSol("USD", v, r)!;
    assert.ok(sol * r.solUsd! <= v + 1e-9, `${v} USD -> ${sol} SOL`);
    assert.ok(sol * r.solUsd! > v - 0.0001 * r.solUsd!); // and within a hair of it
  }
});

test("SOL to USD / EUR for the equivalent line", () => {
  assert.equal(solToUnit("USD", 0.5, rates), 100);
  assert.ok(Math.abs((solToUnit("EUR", 0.55, rates) ?? 0) - 100) < 1e-9);
  assert.equal(solToUnit("USD", 0.5, { solUsd: null, eurUsd: 1.1 }), null);
  assert.equal(solToUnit("SOL", 0.5, { solUsd: null, eurUsd: null }), 0.5);
});

test("the Max figure in a currency always fits in the balance", () => {
  for (const unit of ["SOL", "USD", "EUR"] as const) {
    for (const maxSol of [0.0138, 0.5, 3.21987]) {
      const m = maxInUnit(unit, maxSol, rates)!;
      const back = unitToSol(unit, m, rates)!;
      assert.ok(back <= maxSol + 1e-9, `${unit} ${maxSol}: ${m} -> ${back}`);
    }
  }
  assert.equal(maxInUnit("USD", 1, { solUsd: null, eurUsd: null }), null);
});
