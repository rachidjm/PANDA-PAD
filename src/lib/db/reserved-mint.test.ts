import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "./client";
import { setDbForTests } from "./client";
import { newTestDb } from "./testing";
import { encryptSecretKey } from "@/lib/reserved-mint/crypto";
import { pgClaimReservedMintKey, pgGetReservedMintKey, pgSetReservedMintKey } from "./reserved-mint";

let db: Db;
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => setDbForTests(null));

let n = 0;
const freshPurpose = () => `test-purpose-${++n}`;

function rowFor(purpose: string) {
  const kp = Keypair.generate();
  const enc = encryptSecretKey(kp.secretKey, { RESERVED_MINT_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" })!;
  return { purpose, pubkey: kp.publicKey.toBase58(), ...enc };
}

test("pgSetReservedMintKey: sets once — a second import for the same purpose is refused, the original is untouched", async () => {
  const purpose = freshPurpose();
  const first = rowFor(purpose);
  assert.equal(await pgSetReservedMintKey(db, first), true);
  const second = rowFor(purpose);
  assert.equal(await pgSetReservedMintKey(db, second), false, "never silently replaced");
  const stored = await pgGetReservedMintKey(db, purpose);
  assert.equal(stored!.pubkey, first.pubkey, "unchanged");
});

test("pgGetReservedMintKey: null for a purpose nothing was ever imported for, never marks anything used", async () => {
  assert.equal(await pgGetReservedMintKey(db, freshPurpose()), null);
});

test("pgClaimReservedMintKey: claims once, marks it used — a second claim returns null, there is no fallback row", async () => {
  const purpose = freshPurpose();
  const row = rowFor(purpose);
  await pgSetReservedMintKey(db, row);

  const first = await pgClaimReservedMintKey(db, purpose);
  assert.equal(first!.pubkey, row.pubkey);
  assert.equal(first!.usedAt !== null, true);

  const second = await pgClaimReservedMintKey(db, purpose);
  assert.equal(second, null, "already used — never handed out twice");

  const stillThere = await pgGetReservedMintKey(db, purpose);
  assert.equal(stillThere!.usedAt !== null, true, "the row stays, marked used — pgGetReservedMintKey can still read it for status checks");
});

test("pgClaimReservedMintKey: null for a purpose that was never imported", async () => {
  assert.equal(await pgClaimReservedMintKey(db, freshPurpose()), null);
});
