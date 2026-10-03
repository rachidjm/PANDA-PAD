import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgBindReferral, pgReserveFounderSlot } from "@/lib/db/referrals";
import { pgMarkLegacyFeeWallet } from "@/lib/db/fee-tier";
import { feeTransferInstructions, MIN_SYSTEM_ACCOUNT_LAMPORTS } from "./fee-transfer";
import { feeBpsForWallet } from "./fee-tier";
import { PANDA_FEE_BPS, PANDA_REFERRED_FEE_BPS, PANDA_TREASURY } from "./constants";

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
  // A couple of tests below override this (and FEATURE_FOUNDER_NFT) to exercise a specific tier config —
  // reset both before every test so that override can never leak into a later one just by file order.
  delete process.env.REFERRAL_TIERS;
  delete process.env.FEATURE_FOUNDER_NFT;
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

test("REFERRAL_TIERS is configurable: a non-Founder's first invitee (rank 1) gets whatever the first tier says", async () => {
  process.env.REFERRAL_TIERS = JSON.stringify([{ upTo: null, bps: 5000 }]); // single tier, 50%, for simplicity
  const referrer = Keypair.generate().publicKey;
  const trader = Keypair.generate().publicKey;
  await pgBindReferral(db, trader.toBase58(), referrer.toBase58(), Date.now());
  const ixs = await feeTransferInstructions(fakeConnection({ [referrer.toBase58()]: WELL_FUNDED }), trader, FEE);
  const toReferrer = Number(ixs[0].data.readBigUInt64LE(ixs[0].data.length - 8));
  assert.equal(toReferrer, FEE / 2);
});

// ── End-to-end: a trade's real fee amount (feeBpsForWallet, as buy.ts/sell.ts/amm-trade.ts/jupiter/swap.ts
// actually compute it) flowing into the recruiter split — "comisión con y sin código", "usuarios existentes
// al 0.5%" and "reparto con el reclutador sobre el 0.5%" (the recruiter's cut is of what the invitee ACTUALLY
// paid, the referred rate — never the default rate a non-referred trader would have paid). ────────────────────

const TRADE_SOL_AMOUNT = 10_000_000_000; // 10 SOL, in lamports — an arbitrary but realistic trade size

test("a wallet WITHOUT a code/referrer pays the full default fee, entirely to the treasury — no recruiter to split with", async () => {
  const trader = Keypair.generate().publicKey; // never bound to anyone
  const feeBps = await feeBpsForWallet(trader.toBase58());
  assert.equal(feeBps, PANDA_FEE_BPS, "the default rate — no discount");
  const feeLamports = Math.floor((TRADE_SOL_AMOUNT * feeBps) / 10_000);

  const ixs = await feeTransferInstructions(fakeConnection({}), trader, feeLamports);
  assert.equal(ixs.length, 1);
  const lamports = Number(ixs[0].data.readBigUInt64LE(ixs[0].data.length - 8));
  assert.equal(lamports, feeLamports, "the whole (default-rate) fee goes to the treasury");
});

test("a wallet bound via a code/link pays half the fee, and the recruiter's cut is computed on THAT half — never on the default rate", async () => {
  const referrer = Keypair.generate().publicKey;
  const trader = Keypair.generate().publicKey;
  await pgBindReferral(db, trader.toBase58(), referrer.toBase58(), Date.now());

  const feeBps = await feeBpsForWallet(trader.toBase58());
  assert.equal(feeBps, PANDA_REFERRED_FEE_BPS, "half the default rate");
  const feeLamports = Math.floor((TRADE_SOL_AMOUNT * feeBps) / 10_000);
  assert.equal(feeLamports, Math.floor((TRADE_SOL_AMOUNT * PANDA_FEE_BPS) / 10_000) / 2, "exactly half of what the default-rate fee would have been");

  const ixs = await feeTransferInstructions(fakeConnection({ [referrer.toBase58()]: WELL_FUNDED }), trader, feeLamports);
  const lamportsTo = (pubkey: PublicKey) => {
    const ix = ixs.find((i) => i.keys.some((k) => k.pubkey.equals(pubkey)));
    return ix ? Number(ix.data.readBigUInt64LE(ix.data.length - 8)) : 0;
  };
  const toRecruiter = lamportsTo(referrer);
  // 30% (the default tier-1 share) of the REFERRED fee — not 30% of the default-rate fee, which would be double this.
  const onReferredFee = Math.floor((feeLamports * 3000) / 10_000);
  const onDefaultRateFeeInstead = Math.floor((Math.floor((TRADE_SOL_AMOUNT * PANDA_FEE_BPS) / 10_000) * 3000) / 10_000);
  assert.equal(toRecruiter, onReferredFee);
  assert.equal(toRecruiter, onDefaultRateFeeInstead / 2, "half of what it would be if (wrongly) based on the default rate");
});

test("a wallet grandfathered as legacy (pre-two-tier) pays half the fee too, even with no recruiter — but nobody earns a commission from it (full fee to treasury)", async () => {
  const trader = Keypair.generate().publicKey;
  await pgMarkLegacyFeeWallet(db, trader.toBase58(), Date.now());

  const feeBps = await feeBpsForWallet(trader.toBase58());
  assert.equal(feeBps, PANDA_REFERRED_FEE_BPS);
  const feeLamports = Math.floor((TRADE_SOL_AMOUNT * feeBps) / 10_000);

  const ixs = await feeTransferInstructions(fakeConnection({}), trader, feeLamports);
  assert.equal(ixs.length, 1, "no referrer bound — nothing to split, the whole (already-halved) fee goes to the treasury");
  const lamports = Number(ixs[0].data.readBigUInt64LE(ixs[0].data.length - 8));
  assert.equal(lamports, feeLamports);
});

test("a Founder gets the flat Founder share regardless of REFERRAL_TIERS or rank", async () => {
  process.env.REFERRAL_TIERS = JSON.stringify([{ upTo: null, bps: 100 }]); // deliberately far from the Founder's 30%
  const founder = Keypair.generate().publicKey;
  const trader = Keypair.generate().publicKey;
  await pgReserveFounderSlot(db, founder.toBase58(), Date.now());
  await pgBindReferral(db, trader.toBase58(), founder.toBase58(), Date.now());
  const ixs = await feeTransferInstructions(fakeConnection({ [founder.toBase58()]: WELL_FUNDED }), trader, FEE);
  const toFounder = Number(ixs[0].data.readBigUInt64LE(ixs[0].data.length - 8));
  assert.equal(toFounder, Math.floor((FEE * 3000) / 10_000), "30% flat, not the 1% REFERRAL_TIERS override");
});
