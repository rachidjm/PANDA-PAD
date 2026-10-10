import { test } from "node:test";
import assert from "node:assert/strict";
import { poolDistribution, type TxView } from "./credit";
import { newTestDb } from "@/lib/db/testing";
import { pgCreditHolders, pgKnownRewardSignatures } from "@/lib/db/rewards";

const POOL = "pool";
const CONFIGS = new Map([["cfgA", "mintA"], ["cfgB", "mintB"]]);
const DIST = ["Program log: Instruction: DistributeCreatorFees"];
const tx = (over: Partial<TxView> = {}): TxView => ({ keys: [POOL, "cfgA", "creator"], pre: [50_000_000, 0, 0], post: [61_422_000, 0, 0], fee: 5000, failed: false, logs: DIST, ...over });

test("a distribution the pool sent itself: what it received is its balance change plus the network fee it paid", () => {
  assert.deepEqual(poolDistribution(tx(), POOL, CONFIGS), { mint: "mintA", lamports: 11_427_000 });
});

test("a distribution the coin's creator triggered by hand also counts — the pool paid no fee there", () => {
  const byCreator = tx({ keys: ["creator", "cfgB", POOL], pre: [9_000_000, 0, 100], post: [8_995_000, 0, 6_500_100] });
  assert.deepEqual(poolDistribution(byCreator, POOL, CONFIGS), { mint: "mintB", lamports: 6_500_000 });
});

test("not a distribution to credit: a top-up, a payout, a failed one, one that paid the pool nothing, an unregistered coin", () => {
  assert.equal(poolDistribution(tx({ logs: ["Program 11111111111111111111111111111111 invoke [1]"] }), POOL, CONFIGS), null, "plain transfer to the pool");
  assert.equal(poolDistribution(tx({ failed: true }), POOL, CONFIGS), null);
  assert.equal(poolDistribution(tx({ post: [49_995_000, 0, 0] }), POOL, CONFIGS), null, "only the fee left the pool");
  assert.equal(poolDistribution(tx({ post: [40_000_000, 0, 0] }), POOL, CONFIGS), null, "money leaving the pool is never a credit");
  assert.equal(poolDistribution(tx({ keys: [POOL, "cfgZ", "creator"] }), POOL, CONFIGS), null);
  assert.equal(poolDistribution(tx({ keys: ["someone", "cfgA", "creator"] }), POOL, CONFIGS), null, "the pool isn't in it");
});

test("two registered coins in one transaction: the amount is never guessed", () => {
  assert.equal(poolDistribution(tx({ keys: [POOL, "cfgA", "cfgB"] }), POOL, CONFIGS), "ambiguous");
});

test("the ledger knows a distribution once it is credited — the catch-up never books it twice", async () => {
  const db = await newTestDb();
  assert.equal((await pgKnownRewardSignatures(db, ["sigOld", "sigNew"])).size, 0);
  assert.equal(await pgCreditHolders(db, { mint: "mintA", sourceSig: "sigOld", distributedLamports: 100, credits: [{ address: "ana", lamports: 99 }], dustLamports: 1 }), "applied");
  assert.deepEqual([...(await pgKnownRewardSignatures(db, ["sigOld", "sigNew"]))], ["sigOld"]);
  assert.equal(await pgCreditHolders(db, { mint: "mintA", sourceSig: "sigOld", distributedLamports: 100, credits: [{ address: "ana", lamports: 99 }], dustLamports: 1 }), "duplicate");
  assert.equal((await pgKnownRewardSignatures(db, [])).size, 0);
});
