import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { reservedMintKeys } from "@/lib/db/schema";
import { pgSetReservedMintKey } from "@/lib/db/reserved-mint";
import { encryptSecretKey } from "./crypto";
import { claimLaunchMintKeypair, isReservedPandaLaunch, peekReservedPandaKeypair, PANDA_TOKEN_RESERVED_PURPOSE, RESERVED_PANDA_CREATOR } from "./stock";

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
beforeEach(async () => {
  process.env.RESERVED_MINT_KEY = randomBytes(32).toString("base64");
  // vanity/stock's own fallback (claimMintKeypair) is exercised here too (the "miss" path) — keep it off by
  // default so a fallback result is always a PLAIN random keypair, never accidentally vanity, per test.
  delete process.env.VANITY_STOCK_KEY;
  // The reserved purpose is a fixed, singleton slot by design (claimLaunchMintKeypair never takes a purpose
  // argument) — every test in this file shares one db, so each one starts from a clean table rather than
  // tripping over "already imported" from an earlier test.
  await db.delete(reservedMintKeys);
});

async function seedReserved(): Promise<string> {
  const kp = Keypair.generate();
  const enc = encryptSecretKey(kp.secretKey)!;
  await pgSetReservedMintKey(db, { purpose: PANDA_TOKEN_RESERVED_PURPOSE, pubkey: kp.publicKey.toBase58(), ...enc });
  return kp.publicKey.toBase58();
}

test("isReservedPandaLaunch: only the exact wallet AND ticker PANDA (case/whitespace-insensitive) match", () => {
  assert.equal(isReservedPandaLaunch(RESERVED_PANDA_CREATOR, "PANDA"), true);
  assert.equal(isReservedPandaLaunch(RESERVED_PANDA_CREATOR, "panda"), true, "normalized");
  assert.equal(isReservedPandaLaunch(RESERVED_PANDA_CREATOR, " Panda "), true, "trimmed and normalized");
  assert.equal(isReservedPandaLaunch(RESERVED_PANDA_CREATOR, "PANDA2"), false);
  assert.equal(isReservedPandaLaunch(Keypair.generate().publicKey.toBase58(), "PANDA"), false, "wrong wallet — ticker alone is never enough");
});

test("claimLaunchMintKeypair: the reserved wallet+ticker gets the reserved address, and it's gone after", async () => {
  const pubkey = await seedReserved();
  const { keypair, vanity } = await claimLaunchMintKeypair(RESERVED_PANDA_CREATOR, "PANDA");
  assert.equal(keypair.publicKey.toBase58(), pubkey);
  assert.equal(vanity, true);

  // Already used — a second attempt (e.g. a retry) falls back, never reuses it.
  const second = await claimLaunchMintKeypair(RESERVED_PANDA_CREATOR, "PANDA");
  assert.notEqual(second.keypair.publicKey.toBase58(), pubkey);
});

test("claimLaunchMintKeypair: any other wallet, or any other ticker from the reserved wallet, never gets the reserved address — even though it's available", async () => {
  const pubkey = await seedReserved();

  const otherWallet = await claimLaunchMintKeypair(Keypair.generate().publicKey.toBase58(), "PANDA");
  assert.notEqual(otherWallet.keypair.publicKey.toBase58(), pubkey);

  const otherTicker = await claimLaunchMintKeypair(RESERVED_PANDA_CREATOR, "DOGE");
  assert.notEqual(otherTicker.keypair.publicKey.toBase58(), pubkey);

  // The reservation is untouched — the real match can still claim it.
  const real = await claimLaunchMintKeypair(RESERVED_PANDA_CREATOR, "PANDA");
  assert.equal(real.keypair.publicKey.toBase58(), pubkey);
});

test("claimLaunchMintKeypair: matching wallet+ticker but nothing imported yet falls back to a plain keypair, never blocks", async () => {
  const { keypair, vanity } = await claimLaunchMintKeypair(RESERVED_PANDA_CREATOR, "PANDA");
  assert.equal(vanity, false);
  assert.ok(keypair instanceof Keypair);
});

test("claimLaunchMintKeypair: RESERVED_MINT_KEY missing — falls back, never throws, even for the reserved wallet+ticker", async () => {
  await seedReserved();
  delete process.env.RESERVED_MINT_KEY;
  const { keypair, vanity } = await claimLaunchMintKeypair(RESERVED_PANDA_CREATOR, "PANDA");
  assert.equal(vanity, false);
  assert.ok(keypair instanceof Keypair);
});

test("peekReservedPandaKeypair: reads the reserved keypair WITHOUT marking it used — can be called repeatedly", async () => {
  const pubkey = await seedReserved();
  const first = await peekReservedPandaKeypair();
  assert.equal(first!.publicKey.toBase58(), pubkey);
  const second = await peekReservedPandaKeypair();
  assert.equal(second!.publicKey.toBase58(), pubkey, "still there — peek never claims it");
  // The real claim path still works afterward — peeking never consumed it.
  const claimed = await claimLaunchMintKeypair(RESERVED_PANDA_CREATOR, "PANDA");
  assert.equal(claimed.keypair.publicKey.toBase58(), pubkey);
});

test("peekReservedPandaKeypair: null when nothing is imported", async () => {
  assert.equal(await peekReservedPandaKeypair(), null);
});
