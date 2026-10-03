import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "./client";
import { setDbForTests } from "./client";
import { newTestDb } from "./testing";
import { pgCountLegacyFeeWallets, pgGetCodeForWallet, pgGetWalletByCode, pgIsLegacyFeeWallet, pgMarkLegacyFeeWallet, pgSetRecruiterCode } from "./fee-tier";

let db: Db;
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => setDbForTests(null));

const addr = () => Keypair.generate().publicKey.toBase58();

test("pgMarkLegacyFeeWallet / pgIsLegacyFeeWallet: marks once, idempotent on a repeat call", async () => {
  const wallet = addr();
  assert.equal(await pgIsLegacyFeeWallet(db, wallet), false);
  assert.equal(await pgMarkLegacyFeeWallet(db, wallet, 1000), true);
  assert.equal(await pgMarkLegacyFeeWallet(db, wallet, 2000), false, "already marked — the second call changes nothing");
  assert.equal(await pgIsLegacyFeeWallet(db, wallet), true);
});

test("pgCountLegacyFeeWallets reflects real marks", async () => {
  const before = await pgCountLegacyFeeWallets(db);
  await pgMarkLegacyFeeWallet(db, addr(), 1000);
  await pgMarkLegacyFeeWallet(db, addr(), 1000);
  assert.equal(await pgCountLegacyFeeWallets(db), before + 2);
});

test("pgSetRecruiterCode: sets once, is permanent — a second call for the same wallet never changes it", async () => {
  const wallet = addr();
  assert.equal(await pgSetRecruiterCode(db, wallet, "rachid", 1000), "set");
  assert.equal(await pgGetCodeForWallet(db, wallet), "rachid");
  assert.equal(await pgSetRecruiterCode(db, wallet, "somethingelse", 2000), "already_has_code");
  assert.equal(await pgGetCodeForWallet(db, wallet), "rachid", "unchanged");
});

test("pgSetRecruiterCode: a code is unique across wallets", async () => {
  const a = addr();
  const b = addr();
  assert.equal(await pgSetRecruiterCode(db, a, "taken-code", 1000), "set");
  assert.equal(await pgSetRecruiterCode(db, b, "taken-code", 2000), "code_taken");
  assert.equal(await pgGetCodeForWallet(db, b), null);
});

test("pgGetWalletByCode resolves a real code back to its wallet, null for an unused one", async () => {
  const wallet = addr();
  await pgSetRecruiterCode(db, wallet, "findme", 1000);
  assert.equal(await pgGetWalletByCode(db, "findme"), wallet);
  assert.equal(await pgGetWalletByCode(db, "doesnotexist"), null);
});
