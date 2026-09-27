import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgBindReferral } from "@/lib/db/referrals";
import { feeTransferInstructions, MIN_SYSTEM_ACCOUNT_LAMPORTS } from "./fee-transfer";
import { PANDA_TREASURY } from "./constants";

// Freshly generated keypairs, not real addresses — guaranteed distinct from each other and from PANDA_TREASURY,
// so a test can never accidentally alias the referrer with the treasury (or with another test's trader).
const TRADER = Keypair.generate().publicKey;
const REFERRER = Keypair.generate().publicKey;
const WELL_FUNDED = 5_000_000_000; // 5 SOL — always enough for the treasury side, so it never masks a referrer-specific result

/** A fake Connection whose getBalance answers per-pubkey — treasury is always well funded; the referrer's own balance is what each test varies. */
function fakeConnection(balances: Record<string, number>): Connection {
  return { getBalance: async (pk: PublicKey) => balances[pk.toBase58()] ?? WELL_FUNDED } as unknown as Connection;
}

const SAVED = { ...process.env };
let db: Db;
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
  process.env.REFERRAL_SHARE_BPS = "3000"; // 30%
});

const FEE = 1_000_000; // an arbitrary but realistic fee, in lamports

test("no referrer bound: the whole fee goes to the treasury, one instruction", async () => {
  const trader = Keypair.generate().publicKey; // never bound to anyone in this test's fresh DB
  const ixs = await feeTransferInstructions(fakeConnection({}), trader, FEE);
  assert.equal(ixs.length, 1);
  const info = (ixs[0].keys ?? []).map((k) => k.pubkey.toBase58());
  assert.ok(info.includes(PANDA_TREASURY.toBase58()));
});

test("REFERRALS flag off: split never happens even with a bound referrer", async () => {
  process.env.FEATURE_REFERRALS = "false";
  await pgBindReferral(db, TRADER.toBase58(), REFERRER.toBase58(), Date.now());
  const ixs = await feeTransferInstructions(fakeConnection({}), TRADER, FEE);
  assert.equal(ixs.length, 1, "still one instruction — no split");
});

test("outside the campaign window: split never happens", async () => {
  process.env.REFERRAL_START = "2099-01-01T00:00:00Z";
  process.env.REFERRAL_END = "2099-02-01T00:00:00Z";
  const ixs = await feeTransferInstructions(fakeConnection({}), TRADER, FEE);
  assert.equal(ixs.length, 1);
});

test("a bound, well-funded referrer: two instructions — 30% to the referrer, 70% to the treasury, summing to the exact fee", async () => {
  const trader = Keypair.generate().publicKey;
  await pgBindReferral(db, trader.toBase58(), REFERRER.toBase58(), Date.now());
  const ixs = await feeTransferInstructions(fakeConnection({ [REFERRER.toBase58()]: WELL_FUNDED }), trader, FEE);
  assert.equal(ixs.length, 2);

  const lamportsTo = (pubkey: PublicKey) => {
    const ix = ixs.find((i) => i.keys.some((k) => k.pubkey.equals(pubkey)));
    assert.ok(ix, `no instruction pays ${pubkey.toBase58()}`);
    // SystemProgram transfer: lamports are the last 8 bytes of the instruction data (u64 LE).
    return Number(ix!.data.readBigUInt64LE(ix!.data.length - 8));
  };
  const toReferrer = lamportsTo(REFERRER);
  const toTreasury = lamportsTo(PANDA_TREASURY);
  assert.equal(toReferrer, Math.floor((FEE * 3000) / 10_000));
  assert.equal(toReferrer + toTreasury, FEE, "PANDA never keeps or loses a lamport to rounding — the treasury absorbs it");
});

test("the referrer's OWN balance is below the rent-exempt minimum even after the transfer: the whole fee goes to the treasury instead, trade untouched", async () => {
  const trader = Keypair.generate().publicKey;
  await pgBindReferral(db, trader.toBase58(), REFERRER.toBase58(), Date.now());
  const tinyShare = Math.floor((FEE * 3000) / 10_000);
  const ixs = await feeTransferInstructions(fakeConnection({ [REFERRER.toBase58()]: MIN_SYSTEM_ACCOUNT_LAMPORTS - tinyShare - 1 }), trader, FEE);
  assert.equal(ixs.length, 1, "falls back to a single treasury instruction");
  const lamports = Number(ixs[0].data.readBigUInt64LE(ixs[0].data.length - 8));
  assert.equal(lamports, FEE, "the full fee, not just the treasury's usual share");
});

test("REFERRAL_SHARE_BPS is configurable", async () => {
  process.env.REFERRAL_SHARE_BPS = "5000"; // 50%
  const trader = Keypair.generate().publicKey;
  await pgBindReferral(db, trader.toBase58(), REFERRER.toBase58(), Date.now());
  const ixs = await feeTransferInstructions(fakeConnection({ [REFERRER.toBase58()]: WELL_FUNDED }), trader, FEE);
  const toReferrer = Number(ixs[0].data.readBigUInt64LE(ixs[0].data.length - 8));
  assert.equal(toReferrer, FEE / 2);
});
