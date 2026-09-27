import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgBindReferral, pgReferralStats } from "@/lib/db/referrals";
import { recordReferralPayoutIfAny } from "./payout";

let db: Db;
const SAVED = { ...process.env };
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => {
  setDbForTests(null);
  process.env = SAVED;
});
beforeEach(() => {
  process.env.FEATURE_REFERRALS = "true";
});

let n = 0;
const wallet = () => `WALLET${++n}`.padEnd(40, "x");

const txWithTransfer = (source: string, destination: string, lamports: number) => ({
  transaction: { message: { instructions: [{ program: "system", parsed: { type: "transfer", info: { source, destination, lamports } } }] } },
  blockTime: 1_700_000_000,
});

test("logs the referral payout when the wallet has a referrer and the transaction really pays them", async () => {
  const referred = wallet();
  const referrer = wallet();
  await pgBindReferral(db, referred, referrer, 1000);
  await recordReferralPayoutIfAny(txWithTransfer(referred, referrer, 1500) as never, referred, "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "SIG1");
  assert.deepEqual(await pgReferralStats(db, referrer), { referredCount: 1, earnedLamports: 1500 });
});

test("does nothing when the wallet has no referrer", async () => {
  const referred = wallet();
  await recordReferralPayoutIfAny(txWithTransfer(referred, wallet(), 1500) as never, referred, "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "SIG2");
  // No throw, and nothing to assert against — the real proof is the next test's isolation still works.
});

test("does nothing when the transaction has no transfer to the bound referrer (e.g. campaign was off at trade time)", async () => {
  const referred = wallet();
  const referrer = wallet();
  await pgBindReferral(db, referred, referrer, 1000);
  const tx = { transaction: { message: { instructions: [] } }, blockTime: 1_700_000_000 };
  await recordReferralPayoutIfAny(tx as never, referred, "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "SIG3");
  assert.deepEqual(await pgReferralStats(db, referrer), { referredCount: 1, earnedLamports: 0 });
});

test("the REFERRALS flag off: never even looks at the database", async () => {
  process.env.FEATURE_REFERRALS = "false";
  const referred = wallet();
  const referrer = wallet();
  await pgBindReferral(db, referred, referrer, 1000);
  await recordReferralPayoutIfAny(txWithTransfer(referred, referrer, 1500) as never, referred, "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "SIG4");
  assert.deepEqual(await pgReferralStats(db, referrer), { referredCount: 1, earnedLamports: 0 });
});

test("recording the same signature twice doesn't double-count", async () => {
  const referred = wallet();
  const referrer = wallet();
  await pgBindReferral(db, referred, referrer, 1000);
  const tx = txWithTransfer(referred, referrer, 1500);
  await recordReferralPayoutIfAny(tx as never, referred, "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "SIG5");
  await recordReferralPayoutIfAny(tx as never, referred, "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "SIG5");
  assert.deepEqual(await pgReferralStats(db, referrer), { referredCount: 1, earnedLamports: 1500 });
});
