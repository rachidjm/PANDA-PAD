import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { buildFeeTransaction, checkSignedFeeTx } from "./fee";

// Deterministic keys, made once (key generation is slow in pure JS).
const user = Keypair.fromSeed(new Uint8Array(32).fill(7));
const other = Keypair.fromSeed(new Uint8Array(32).fill(9));
const WALLET = user.publicKey.toBase58();
const TREASURY = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const HASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k"; // any well-formed blockhash

const signed = (tx: Transaction, key = user) => {
  tx.sign(key);
  return tx.serialize().toString("base64");
};
const good = () => buildFeeTransaction({ wallet: WALLET, treasury: TREASURY, lamports: 5_000_000, blockhash: HASH });
const expected = { wallet: WALLET, treasury: TREASURY, lamports: 5_000_000 };

test("a fee transaction signed by the wallet, for exactly the agreed amount to the treasury, is accepted", () => {
  assert.deepEqual(checkSignedFeeTx(signed(good()), expected), { ok: true });
});

test("a different amount, destination or payer is refused", () => {
  assert.deepEqual(checkSignedFeeTx(signed(good()), { ...expected, lamports: 5_000_001 }), { ok: false, reason: "amount" });
  assert.deepEqual(checkSignedFeeTx(signed(good()), { ...expected, treasury: new PublicKey(Buffer.alloc(32, 4)).toBase58() }), { ok: false, reason: "to" });
  assert.deepEqual(checkSignedFeeTx(signed(good()), { ...expected, wallet: other.publicKey.toBase58() }), { ok: false, reason: "payer" });
});

test("a smaller amount than agreed, sent by the browser, is refused", () => {
  const cheap = buildFeeTransaction({ wallet: WALLET, treasury: TREASURY, lamports: 1, blockhash: HASH });
  assert.equal(checkSignedFeeTx(signed(cheap), expected).ok, false);
});

test("extra instructions smuggled into the transaction are refused", () => {
  const tx = good();
  tx.add(SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: other.publicKey, lamports: 1 }));
  assert.deepEqual(checkSignedFeeTx(signed(tx), expected), { ok: false, reason: "instructions" });
});

test("an unsigned or wrongly signed transaction is refused", () => {
  const unsigned = good().serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  assert.equal(checkSignedFeeTx(unsigned, expected).ok, false);
  const forged = good();
  forged.sign(user);
  forged.signatures[0].signature = Buffer.alloc(64, 1); // a signature that is not the payer's
  assert.equal(checkSignedFeeTx(forged.serialize({ verifySignatures: false }).toString("base64"), expected).ok, false);
});

test("junk is refused, never thrown", () => {
  for (const v of [undefined, null, 5, "", "abc", "A".repeat(200), "A".repeat(5000)]) assert.equal(checkSignedFeeTx(v, expected).ok, false);
});
