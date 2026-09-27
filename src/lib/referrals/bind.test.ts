import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgGetReferrer } from "@/lib/db/referrals";
import { tryBindReferral } from "./bind";

const REFERRED = "35gHwjqiTsPPCzLpQhCcJZBGiUR9TSDYNPuxUdvERVkh";
const REFERRER = "DCZaeTXLDwkwE4a8xayS3o9hCiPwgH1deotvyS5VEE6n";
const OTHER = "3eJExN3JCpXjADDKSqs3uV9N1kR2fBQiUrtP4zBwYX68";

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
  process.env.REFERRAL_START = "2020-01-01T00:00:00Z";
  process.env.REFERRAL_END = "2099-01-01T00:00:00Z";
  process.env.SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
});

// The mock has to echo back whichever wallet is actually under test (`firstFunderCheck` only trusts a
// transfer whose `toUserAccount` matches the wallet it was asked about).
const cleanFunder = (referred: string) =>
  ((async () => ({ ok: true, json: async () => [{ nativeTransfers: [{ fromUserAccount: "SomeoneElse", toUserAccount: referred, amount: 500 }] }] })) as unknown as typeof fetch);
const selfFundedFunder = (referred: string, referrer: string) =>
  ((async () => ({ ok: true, json: async () => [{ nativeTransfers: [{ fromUserAccount: referrer, toUserAccount: referred, amount: 500 }] }] })) as unknown as typeof fetch);
const unknownFunder = (async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch;

test("tryBindReferral: the flag off rejects outright, even with everything else valid", async () => {
  process.env.FEATURE_REFERRALS = "false";
  assert.equal(await tryBindReferral(REFERRED, REFERRER, cleanFunder(REFERRED)), "rejected");
  assert.equal(await pgGetReferrer(db, REFERRED), null);
});

test("tryBindReferral: rejects an invalid address, and self-referral, before ever touching the chain or the database", async () => {
  assert.equal(await tryBindReferral(OTHER, "not an address", cleanFunder(OTHER)), "rejected");
  assert.equal(await tryBindReferral(OTHER, OTHER, cleanFunder(OTHER)), "rejected", "a wallet cannot refer itself");
});

test("tryBindReferral: rejects outside the campaign window", async () => {
  process.env.REFERRAL_START = "2099-01-01T00:00:00Z";
  process.env.REFERRAL_END = "2099-02-01T00:00:00Z";
  const w = `W${Math.random()}`;
  assert.equal(await tryBindReferral(w, REFERRER, cleanFunder(w)), "rejected");
});

test("tryBindReferral: 'bound' on a real, clean, first-time link — and it really is in the database", async () => {
  const w = `W${Math.random()}`;
  assert.equal(await tryBindReferral(w, REFERRER, cleanFunder(w)), "bound");
  assert.equal(await pgGetReferrer(db, w), REFERRER);
});

test("tryBindReferral: 'already_bound' the second time, even offering a different referrer", async () => {
  const w = `W${Math.random()}`;
  assert.equal(await tryBindReferral(w, REFERRER, cleanFunder(w)), "bound");
  assert.equal(await tryBindReferral(w, OTHER, cleanFunder(w)), "already_bound");
  assert.equal(await pgGetReferrer(db, w), REFERRER, "unchanged");
});

test("tryBindReferral: 'rejected' (terminal) when the anti-abuse check finds the referred wallet was self-funded", async () => {
  const w = `W${Math.random()}`;
  assert.equal(await tryBindReferral(w, REFERRER, selfFundedFunder(w, REFERRER)), "rejected");
  assert.equal(await pgGetReferrer(db, w), null);
});

test("tryBindReferral: 'retry_later' (not terminal) when the anti-abuse check is inconclusive", async () => {
  const w = `W${Math.random()}`;
  assert.equal(await tryBindReferral(w, REFERRER, unknownFunder), "retry_later");
  assert.equal(await pgGetReferrer(db, w), null, "not bound yet — a later sign-in may still succeed");
});
