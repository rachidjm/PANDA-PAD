import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgFounderAllocation, pgGetReferrer } from "@/lib/db/referrals";
import { pgGetCodeForWallet, pgSetRecruiterCode } from "@/lib/db/fee-tier";
import { pgAddTrades } from "@/lib/db/trades";
import { canApplyRecruiterCode, tryApplyRecruiterCode, tryBindReferral } from "./bind";

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
  process.env.SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
  // A couple of tests below set this — reset it so it can never leak into a later one just by file order.
  delete process.env.FEATURE_FOUNDER_NFT;
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

// Founder slots are no longer triggered by binding — a freshly-bound invitee hasn't traded yet, so it can't
// make a recruiter cross the valid-invitee volume threshold. See src/lib/referrals/founder.test.ts for the
// real trigger (the trade-confirmation hook).
test("tryBindReferral: binding itself never reserves a Founder slot, even with FEATURE_FOUNDER_NFT on and many invitees", async () => {
  process.env.FEATURE_FOUNDER_NFT = "true";
  const referrer = Keypair.generate().publicKey.toBase58();
  for (let i = 0; i < 3; i++) {
    const w = `W${Math.random()}`;
    assert.equal(await tryBindReferral(w, referrer, cleanFunder(w)), "bound");
  }
  assert.equal(await pgFounderAllocation(db, referrer), null);
});

// ── tryApplyRecruiterCode / canApplyRecruiterCode: the manual "I have a code" flow ──────────────────────────────

const aTrade = (overrides: Partial<Parameters<typeof pgAddTrades>[2][number]> = {}) => [
  { mint: "SomeMint111111111111111111111111111111111", ticker: "X", side: "buy" as const, solAmount: 1, tokenAmount: 1, solPriceUsdAtTrade: 100, signature: `sig-${Math.random()}`, ts: Date.now(), ...overrides },
];

test("tryApplyRecruiterCode: a real code resolves to its owner and binds exactly like their link would", async () => {
  const referrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, referrer, `code${Math.random().toString(36).slice(2, 8)}`, Date.now());
  const theCode = (await pgGetCodeForWallet(db, referrer))!;
  const w = `W${Math.random()}`;
  assert.equal(await tryApplyRecruiterCode(w, theCode, cleanFunder(w)), "bound");
  assert.equal(await pgGetReferrer(db, w), referrer);
});

test("tryApplyRecruiterCode: a code nobody owns is 'invalid_code', nothing bound", async () => {
  const w = `W${Math.random()}`;
  assert.equal(await tryApplyRecruiterCode(w, "doesnotexist", cleanFunder(w)), "invalid_code");
  assert.equal(await pgGetReferrer(db, w), null);
});

test("tryApplyRecruiterCode: rejected (not even checked) once the wallet has already made a trade — a code only applies before the first one", async () => {
  const referrer = Keypair.generate().publicKey.toBase58();
  const codeWord = `rx${Math.random().toString(36).slice(2, 8)}`;
  await pgSetRecruiterCode(db, referrer, codeWord, Date.now());
  const w = `W${Math.random()}`;
  await pgAddTrades(db, w, aTrade());
  assert.equal(await tryApplyRecruiterCode(w, codeWord, cleanFunder(w)), "already_traded");
  assert.equal(await pgGetReferrer(db, w), null, "never bound");
});

test("tryApplyRecruiterCode: 'already_bound' if the wallet already has a referrer, even with a different, real code", async () => {
  const firstReferrer = Keypair.generate().publicKey.toBase58();
  const secondReferrer = Keypair.generate().publicKey.toBase58();
  const codeWord = `ry${Math.random().toString(36).slice(2, 8)}`;
  await pgSetRecruiterCode(db, secondReferrer, codeWord, Date.now());
  const w = `W${Math.random()}`;
  assert.equal(await tryBindReferral(w, firstReferrer, cleanFunder(w)), "bound");
  assert.equal(await tryApplyRecruiterCode(w, codeWord, cleanFunder(w)), "already_bound");
  assert.equal(await pgGetReferrer(db, w), firstReferrer, "unchanged");
});

test("canApplyRecruiterCode: true for a fresh wallet, false once it has a referrer, false once it has traded", async () => {
  const fresh = `W${Math.random()}`;
  assert.equal(await canApplyRecruiterCode(fresh), true);

  const bound = `W${Math.random()}`;
  await tryBindReferral(bound, Keypair.generate().publicKey.toBase58(), cleanFunder(bound));
  assert.equal(await canApplyRecruiterCode(bound), false);

  const traded = `W${Math.random()}`;
  await pgAddTrades(db, traded, aTrade());
  assert.equal(await canApplyRecruiterCode(traded), false);
});

test("canApplyRecruiterCode: always false with the flag off", async () => {
  process.env.FEATURE_REFERRALS = "false";
  assert.equal(await canApplyRecruiterCode(`W${Math.random()}`), false);
});
