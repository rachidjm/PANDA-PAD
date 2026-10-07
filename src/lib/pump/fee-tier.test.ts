import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgBindReferral } from "@/lib/db/referrals";
import { pgAddTrades } from "@/lib/db/trades";
import { pgMarkLegacyFeeWallet } from "@/lib/db/fee-tier";
import { feeBpsForWallet } from "./fee-tier";
import { PANDA_FEE_BPS, PANDA_REFERRED_FEE_BPS } from "./constants";
import { DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD } from "@/lib/referrals/tiers-config";

const addr = () => Keypair.generate().publicKey.toBase58();

/** Logs one trade whose SOL-amount × price equals exactly `usd`, so volume math in this test is exact — same
 *  trick src/lib/db/referrals.test.ts's own seedTradeUsd uses. */
async function seedTradeUsd(w: string, usd: number) {
  await pgAddTrades(db, w, [
    { mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", ticker: "X", side: "buy", solAmount: usd, tokenAmount: 1, solPriceUsdAtTrade: 1, signature: `SIG-${w}-${Math.random()}`, ts: 1000 },
  ]);
}

let db: Db;
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => setDbForTests(null));
beforeEach(() => {
  process.env.FEATURE_REFERRALS = "true";
});

test("feeBpsForWallet: a brand new wallet, no referrer, not legacy, pays the default rate", async () => {
  assert.equal(await feeBpsForWallet(addr()), PANDA_FEE_BPS);
});

test("feeBpsForWallet: a wallet just bound to a recruiter still pays the default rate — the discount isn't immediate", async () => {
  const wallet = addr();
  await pgBindReferral(db, wallet, addr(), Date.now());
  assert.equal(await feeBpsForWallet(wallet), PANDA_FEE_BPS);
});

test("feeBpsForWallet: below the discount threshold stays at the default rate even with a recruiter", async () => {
  const wallet = addr();
  await pgBindReferral(db, wallet, addr(), Date.now());
  await seedTradeUsd(wallet, DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD - 1);
  assert.equal(await feeBpsForWallet(wallet), PANDA_FEE_BPS);
});

test("feeBpsForWallet: once a referred wallet's OWN volume reaches the threshold, it pays the referred rate — for life", async () => {
  const wallet = addr();
  await pgBindReferral(db, wallet, addr(), Date.now());
  await seedTradeUsd(wallet, DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD);
  assert.equal(await feeBpsForWallet(wallet), PANDA_REFERRED_FEE_BPS);
});

test("feeBpsForWallet: volume with NO recruiter never unlocks the referred rate on its own", async () => {
  const wallet = addr();
  await seedTradeUsd(wallet, DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD * 2);
  assert.equal(await feeBpsForWallet(wallet), PANDA_FEE_BPS);
});

test("feeBpsForWallet: a legacy (grandfathered) wallet pays the referred rate even with no recruiter at all", async () => {
  const wallet = addr();
  await pgMarkLegacyFeeWallet(db, wallet, Date.now());
  assert.equal(await feeBpsForWallet(wallet), PANDA_REFERRED_FEE_BPS);
});

test("feeBpsForWallet: legacy AND referred is still just the referred rate (no stacking, no double discount)", async () => {
  const wallet = addr();
  await pgBindReferral(db, wallet, addr(), Date.now());
  await pgMarkLegacyFeeWallet(db, wallet, Date.now());
  assert.equal(await feeBpsForWallet(wallet), PANDA_REFERRED_FEE_BPS);
});

test("feeBpsForWallet: falls back to the default rate (never silently undercharges) when Postgres isn't configured", async () => {
  setDbForTests(null);
  try {
    assert.equal(await feeBpsForWallet(addr()), PANDA_FEE_BPS);
  } finally {
    setDbForTests(db);
  }
});
