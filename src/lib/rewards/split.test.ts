import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHolderCredits } from "./split";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const sum = (xs: { lamports: number }[]) => xs.reduce((a, c) => a + c.lamports, 0);

test("credits + dust always equal what was distributed (fuzz)", () => {
  const rand = rng(7);
  for (let i = 0; i < 1000; i++) {
    const distributed = Math.floor(rand() * 5e10);
    const holders = Array.from({ length: 1 + Math.floor(rand() * 60) }, (_, j) => ({
      address: `H${Math.floor(rand() * 40)}`, // repeats on purpose: same wallet, several accounts
      amount: BigInt(Math.floor(rand() * 1e15)) * BigInt(1 + (j % 3)),
    }));
    const { credits, dust } = computeHolderCredits(holders, distributed);
    assert.equal(sum(credits) + dust, distributed);
    assert.ok(dust >= 0 && dust < new Set(holders.map((h) => h.address)).size + 1);
    assert.ok(credits.every((c) => Number.isSafeInteger(c.lamports) && c.lamports > 0));
    assert.equal(new Set(credits.map((c) => c.address)).size, credits.length, "one credit per wallet");
  }
});

test("proportional and exact on a simple case", () => {
  const { credits, dust } = computeHolderCredits(
    [
      { address: "A", amount: BigInt(1) },
      { address: "B", amount: BigInt(3) },
    ],
    1000
  );
  assert.deepEqual(credits, [
    { address: "A", lamports: 250 },
    { address: "B", lamports: 750 },
  ]);
  assert.equal(dust, 0);
});

test("the float version would have lost lamports on huge balances; this one does not", () => {
  // 18-decimal-style raw balances exceed 2^53, where float division silently rounds.
  const big = BigInt("9007199254740993000000"); // > Number.MAX_SAFE_INTEGER
  const { credits, dust } = computeHolderCredits(
    [
      { address: "A", amount: big },
      { address: "B", amount: big + BigInt(1) },
    ],
    1_000_000_007
  );
  assert.equal(sum(credits) + dust, 1_000_000_007);
});

test("no holders / zero balances: everything is dust; bad input throws", () => {
  assert.deepEqual(computeHolderCredits([], 500), { credits: [], dust: 500 });
  assert.deepEqual(computeHolderCredits([{ address: "A", amount: BigInt(0) }], 500), { credits: [], dust: 500 });
  assert.throws(() => computeHolderCredits([], -1));
  assert.throws(() => computeHolderCredits([], 1.5));
  assert.throws(() => computeHolderCredits([], NaN));
});
