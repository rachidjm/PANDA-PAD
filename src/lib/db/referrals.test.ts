import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "./client";
import { newTestDb } from "./testing";
import { pgBindReferral, pgGetReferrer, pgRecordReferralPayout, pgReferralStats } from "./referrals";

let db: Db;
before(async () => {
  db = await newTestDb();
});

let n = 0;
const wallet = () => `WALLET${++n}`.padEnd(40, "x");

test("pgBindReferral: first-touch wins — a second bind of the same wallet changes nothing, even to a different referrer", async () => {
  const referred = wallet();
  const first = wallet();
  const second = wallet();
  assert.equal(await pgBindReferral(db, referred, first, 1000), true);
  assert.equal(await pgBindReferral(db, referred, second, 2000), false, "already bound — this call does nothing");
  assert.equal(await pgGetReferrer(db, referred), first);
});

test("pgGetReferrer: null for a wallet nobody referred", async () => {
  assert.equal(await pgGetReferrer(db, wallet()), null);
});

test("referrals_no_self: the database itself refuses a wallet referring itself", async () => {
  const w = wallet();
  await assert.rejects(() => pgBindReferral(db, w, w, 1000));
});

test("pgRecordReferralPayout: one row per (signature, referrer) — recording the same payout twice is a no-op", async () => {
  const referrer = wallet();
  const referred = wallet();
  const row = { signature: "SIG1", referrer, referred, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 1500, ts: 1000 };
  assert.equal(await pgRecordReferralPayout(db, row), true);
  assert.equal(await pgRecordReferralPayout(db, row), false);
  assert.equal((await pgReferralStats(db, referrer)).earnedLamports, 1500);
});

test("pgReferralStats: counts referred wallets and sums only THIS referrer's verified payouts", async () => {
  const referrer = wallet();
  const other = wallet();
  await pgBindReferral(db, wallet(), referrer, 1000);
  await pgBindReferral(db, wallet(), referrer, 1000);
  await pgBindReferral(db, wallet(), other, 1000);
  await pgRecordReferralPayout(db, { signature: "S1", referrer, referred: wallet(), mint: "M1".padEnd(40, "x"), lamports: 100, ts: 1 });
  await pgRecordReferralPayout(db, { signature: "S2", referrer, referred: wallet(), mint: "M1".padEnd(40, "x"), lamports: 250, ts: 2 });
  await pgRecordReferralPayout(db, { signature: "S3", referrer: other, referred: wallet(), mint: "M1".padEnd(40, "x"), lamports: 999, ts: 3 });
  assert.deepEqual(await pgReferralStats(db, referrer), { referredCount: 2, earnedLamports: 350 });
});

test("pgReferralStats: zero, not null/undefined, for a referrer with nobody and nothing", async () => {
  assert.deepEqual(await pgReferralStats(db, wallet()), { referredCount: 0, earnedLamports: 0 });
});
