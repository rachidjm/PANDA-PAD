import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgBindReferral } from "@/lib/db/referrals";
import { pgMarkLegacyFeeWallet } from "@/lib/db/fee-tier";
import { feeBpsForWallet } from "./fee-tier";
import { PANDA_FEE_BPS, PANDA_REFERRED_FEE_BPS } from "./constants";

const addr = () => Keypair.generate().publicKey.toBase58();

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

test("feeBpsForWallet: a wallet bound to a recruiter pays the referred rate, permanently", async () => {
  const wallet = addr();
  await pgBindReferral(db, wallet, addr(), Date.now());
  assert.equal(await feeBpsForWallet(wallet), PANDA_REFERRED_FEE_BPS);
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
