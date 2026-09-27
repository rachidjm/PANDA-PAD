import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgAddVanityKeys, pgVanityStockCount } from "@/lib/db/vanity";
import { encryptSecretKey } from "./crypto";
import { claimMintKeypair } from "./stock";

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
  process.env.VANITY_STOCK_KEY = randomBytes(32).toString("base64");
});

let n = 0;
const freshSuffix = () => `test-suffix-${++n}`; // a distinct "stock" per test, never seeing another test's rows

async function seed(suffix: string, count: number) {
  const rows = Array.from({ length: count }, () => {
    const kp = Keypair.generate();
    const enc = encryptSecretKey(kp.secretKey)!;
    return { pubkey: kp.publicKey.toBase58(), suffix, ...enc };
  });
  await pgAddVanityKeys(db, rows);
  return rows;
}

test("no VANITY_STOCK_KEY configured: falls back to a plain random keypair", async () => {
  delete process.env.VANITY_STOCK_KEY;
  const { keypair, vanity } = await claimMintKeypair(freshSuffix());
  assert.equal(vanity, false);
  assert.ok(keypair instanceof Keypair);
});

test("a stocked key is claimed, decrypted, and returned as a real usable Keypair", async () => {
  const suffix = freshSuffix();
  const [seeded] = await seed(suffix, 1);
  const { keypair, vanity } = await claimMintKeypair(suffix);
  assert.equal(vanity, true);
  assert.equal(keypair.publicKey.toBase58(), seeded.pubkey);
});

test("a claimed key is never handed out twice — the second call falls back to random once the stock is empty", async () => {
  const suffix = freshSuffix();
  const [a] = await seed(suffix, 1);
  const first = await claimMintKeypair(suffix);
  assert.equal(first.keypair.publicKey.toBase58(), a.pubkey);
  const second = await claimMintKeypair(suffix);
  assert.equal(second.vanity, false, "stock is empty now");
  assert.notEqual(second.keypair.publicKey.toBase58(), a.pubkey);
});

test("empty stock: falls back to random, never throws", async () => {
  const { keypair, vanity } = await claimMintKeypair(freshSuffix());
  assert.equal(vanity, false);
  assert.ok(keypair instanceof Keypair);
});

test("stock count reflects claims", async () => {
  const suffix = freshSuffix();
  await seed(suffix, 5);
  assert.equal(await pgVanityStockCount(db, suffix), 5);
  await claimMintKeypair(suffix);
  assert.equal(await pgVanityStockCount(db, suffix), 4);
});

test("a row encrypted under a DIFFERENT key than the one now configured: claim fails closed, falls back to random (the row stays claimed — it's lost either way)", async () => {
  const suffix = freshSuffix();
  const kp = Keypair.generate();
  const wrongKeyEnc = encryptSecretKey(kp.secretKey, { VANITY_STOCK_KEY: randomBytes(32).toString("base64") })!;
  await pgAddVanityKeys(db, [{ pubkey: kp.publicKey.toBase58(), suffix, ...wrongKeyEnc }]);
  const { vanity, keypair } = await claimMintKeypair(suffix);
  assert.equal(vanity, false);
  assert.notEqual(keypair.publicKey.toBase58(), kp.publicKey.toBase58());
  assert.equal(await pgVanityStockCount(db, suffix), 0, "the unreadable row was still consumed, not left for a retry that would fail the same way");
});
