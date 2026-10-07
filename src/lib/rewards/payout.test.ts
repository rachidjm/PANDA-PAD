import { test } from "node:test";
import assert from "node:assert/strict";
import { batchPayouts, computeEligiblePayouts, shouldRunPayout } from "./payout";

test("shouldRunPayout: only once the pending amount reaches the minimum", () => {
  assert.equal(shouldRunPayout(99, 100), false);
  assert.equal(shouldRunPayout(100, 100), true);
  assert.equal(shouldRunPayout(101, 100), true);
  assert.equal(shouldRunPayout(0, 100), false);
});

test("computeEligiblePayouts: a real holder with a real balance gets paid in full, under the cap", () => {
  const out = computeEligiblePayouts([{ wallet: "A", unclaimedLamports: 1000 }], { exclude: new Set(), minPerWalletLamports: 10, maxPerWalletLamports: 10_000 });
  assert.deepEqual(out, [{ wallet: "A", lamports: 1000 }]);
});

test("computeEligiblePayouts: excluded addresses (curve, pool, shareholders) never appear, however much they'd otherwise get", () => {
  const out = computeEligiblePayouts(
    [{ wallet: "CURVE", unclaimedLamports: 1_000_000 }, { wallet: "A", unclaimedLamports: 1000 }],
    { exclude: new Set(["CURVE"]), minPerWalletLamports: 10, maxPerWalletLamports: 10_000_000 }
  );
  assert.deepEqual(out, [{ wallet: "A", lamports: 1000 }]);
});

test("computeEligiblePayouts: a balance under the per-wallet minimum is skipped entirely, not paid partially", () => {
  const out = computeEligiblePayouts([{ wallet: "A", unclaimedLamports: 5 }], { exclude: new Set(), minPerWalletLamports: 10, maxPerWalletLamports: 10_000 });
  assert.deepEqual(out, []);
});

test("computeEligiblePayouts: a balance over the per-claim cap is capped, not refused — the rest waits for next time", () => {
  const out = computeEligiblePayouts([{ wallet: "WHALE", unclaimedLamports: 5_000_000 }], { exclude: new Set(), minPerWalletLamports: 10, maxPerWalletLamports: 2_000_000 });
  assert.deepEqual(out, [{ wallet: "WHALE", lamports: 2_000_000 }]);
});

test("computeEligiblePayouts: zero or negative balances never produce a payout", () => {
  const out = computeEligiblePayouts([{ wallet: "A", unclaimedLamports: 0 }, { wallet: "B", unclaimedLamports: -5 }], { exclude: new Set(), minPerWalletLamports: 1, maxPerWalletLamports: 100 });
  assert.deepEqual(out, []);
});

test("batchPayouts: groups into fixed-size chunks, the last one shorter", () => {
  const payouts = [1, 2, 3, 4, 5];
  assert.deepEqual(batchPayouts(payouts, 2), [[1, 2], [3, 4], [5]]);
});

test("batchPayouts: everything fits in one batch when the size is bigger than the list", () => {
  assert.deepEqual(batchPayouts([1, 2], 10), [[1, 2]]);
});

test("batchPayouts: an empty list is zero batches, not one empty batch", () => {
  assert.deepEqual(batchPayouts([], 10), []);
});

test("batchPayouts: a non-positive batch size is treated as 'everything in one batch' rather than looping forever", () => {
  assert.deepEqual(batchPayouts([1, 2, 3], 0), [[1, 2, 3]]);
});
