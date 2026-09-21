import { test } from "node:test";
import assert from "node:assert/strict";
import { buyShortfall, maxBuyAmount, NETWORK_BUFFER_SOL, requiredSolForBuy } from "./limits";

test("what a buy needs: the amount, PANDA's 1% on top, and a cushion for network fees and token accounts", () => {
  assert.ok(Math.abs(requiredSolForBuy(0.5) - (0.505 + NETWORK_BUFFER_SOL)) < 1e-12);
  assert.equal(requiredSolForBuy(0), 0);
  assert.equal(requiredSolForBuy(-1), 0);
  assert.equal(requiredSolForBuy(NaN), 0);
});

test("THE REPORTED CASE: 0.02 SOL in the wallet cannot buy 0.5 SOL, and the app says so with the real numbers", () => {
  const s = buyShortfall(0.5, 0.02)!;
  assert.ok(s);
  assert.ok(Math.abs(s.need - 0.511) < 1e-9);
  assert.equal(s.have, 0.02);
  assert.equal(s.max, 0.0138, "0.02 SOL can buy at most 0.0138 SOL worth");
});

test("an affordable buy has no shortfall; an unknown balance never blocks", () => {
  assert.equal(buyShortfall(0.5, 1), null);
  assert.equal(buyShortfall(0.5, null), null, "no balance read: don't block on a guess");
  assert.equal(buyShortfall(0, 0.001), null, "nothing entered");
  assert.equal(buyShortfall(0.5, requiredSolForBuy(0.5)), null, "exactly enough is enough");
});

test("the maximum never asks for more than the wallet has (fuzz)", () => {
  let seed = 9;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 2000; i++) {
    const balance = rnd() * 5;
    const max = maxBuyAmount(balance);
    assert.ok(max >= 0);
    assert.ok(requiredSolForBuy(max) <= balance + 1e-12, `balance ${balance} max ${max}`);
    assert.equal(buyShortfall(max, balance), null, "buying the maximum is always affordable");
    if (max > 0) assert.ok(buyShortfall(max + 0.0002, balance) !== null, "a little more is not");
  }
  assert.equal(maxBuyAmount(0), 0);
  assert.equal(maxBuyAmount(NETWORK_BUFFER_SOL), 0, "only the cushion: nothing to spend");
  assert.equal(maxBuyAmount(NaN), 0);
});
