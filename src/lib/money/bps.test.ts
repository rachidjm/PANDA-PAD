import { test } from "node:test";
import assert from "node:assert/strict";
import { bpsOf, splitPool, MoneyError } from "./bps";

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("bpsOf takes exact integer shares", () => {
  assert.equal(bpsOf(BigInt(1_000_000), 500), BigInt(50_000));
  assert.equal(bpsOf(BigInt(1), 500), BigInt(0)); // floors, never rounds up past the amount
  assert.equal(bpsOf(BigInt(10_000), 10_000), BigInt(10_000));
});

test("bpsOf rejects bad input", () => {
  assert.throws(() => bpsOf(BigInt(-1), 500), MoneyError);
  assert.throws(() => bpsOf(BigInt(1), -1), MoneyError);
  assert.throws(() => bpsOf(BigInt(1), 10_001), MoneyError);
  assert.throws(() => bpsOf(BigInt(1), 1.5), MoneyError);
  assert.throws(() => bpsOf(BigInt(1), NaN), MoneyError);
});

test("splitPool never allocates more than the pool and accounts for all dust (fuzz)", () => {
  const rand = rng(42);
  for (let i = 0; i < 2000; i++) {
    const pool = BigInt(Math.floor(rand() * 1e12));
    const n = 1 + Math.floor(rand() * 40);
    const weights = Array.from({ length: n }, () => BigInt(Math.floor(rand() * 1e9)));
    const { allocations, dust } = splitPool(pool, weights);
    const sum = allocations.reduce((a, b) => a + b, BigInt(0));
    assert.ok(sum <= pool, "over-allocation");
    assert.equal(sum + dust, pool, "funds lost or created");
    assert.ok(dust >= BigInt(0));
    assert.ok(allocations.every((a) => a >= BigInt(0)));
  }
});

test("splitPool: zero total weight returns the whole pool as dust", () => {
  const { allocations, dust } = splitPool(BigInt(1000), [BigInt(0), BigInt(0)]);
  assert.deepEqual(allocations, [BigInt(0), BigInt(0)]);
  assert.equal(dust, BigInt(1000));
});

test("splitPool is deterministic and proportional", () => {
  const a = splitPool(BigInt(100), [BigInt(1), BigInt(3)]);
  assert.deepEqual(a.allocations, [BigInt(25), BigInt(75)]);
  assert.equal(a.dust, BigInt(0));
  assert.deepEqual(splitPool(BigInt(100), [BigInt(1), BigInt(3)]), a);
});

test("splitPool rejects negative values", () => {
  assert.throws(() => splitPool(BigInt(-1), [BigInt(1)]), MoneyError);
  assert.throws(() => splitPool(BigInt(1), [BigInt(-1)]), MoneyError);
});
