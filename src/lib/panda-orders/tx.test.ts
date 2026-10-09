import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { hasOrdersKey, openTx, sealTx } from "./crypto";
import { closeInstructions, messageHash, nonceAddress, orderTransaction, parseNonce, setupInstructions, verifySignedOrder } from "./tx";

const KEY_ENV = { PANDA_ORDERS_KEY: randomBytes(32).toString("base64") };
const blockhash = () => bs58.encode(randomBytes(32));
const sale = (wallet: PublicKey) => [new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: wallet, isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) })];

test("an order is durable: AdvanceNonce FIRST, the wallet as nonce authority, fee payer and ONLY signer", () => {
  const wallet = Keypair.generate().publicKey;
  const nonce = Keypair.generate().publicKey;
  const value = blockhash();
  const tx = orderTransaction({ wallet, nonceAccount: nonce, nonceValue: value, sale: sale(wallet), fee: [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 10 })] });
  const m = tx.message;
  assert.equal(m.recentBlockhash, value, "the nonce value IS the blockhash");
  assert.equal(m.header.numRequiredSignatures, 1);
  assert.equal(m.staticAccountKeys[0].toBase58(), wallet.toBase58());
  const first = m.compiledInstructions[0];
  assert.ok(m.staticAccountKeys[first.programIdIndex].equals(SystemProgram.programId));
  assert.equal(Buffer.from(first.data).readUInt32LE(0), 4, "SystemInstruction::AdvanceNonceAccount");
  assert.ok(m.staticAccountKeys[first.accountKeyIndexes[0]].equals(nonce));
  assert.ok(m.staticAccountKeys[first.accountKeyIndexes[2]].equals(wallet), "only the wallet can advance (= cancel) it");
});

test("a sell and a stop built on the same nonce share it — only one of them can ever land", () => {
  const wallet = Keypair.generate().publicKey;
  const nonce = Keypair.generate().publicKey;
  const value = blockhash();
  const a = orderTransaction({ wallet, nonceAccount: nonce, nonceValue: value, sale: sale(wallet), fee: [] });
  const b = orderTransaction({ wallet, nonceAccount: nonce, nonceValue: value, sale: sale(wallet), fee: [] });
  assert.equal(a.message.recentBlockhash, b.message.recentBlockhash);
  assert.notEqual(messageHash(a.message.serialize()), messageHash(b.message.serialize()));
});

test("submission check: the exact message, signed by the wallet → OK; one byte changed by the wallet → refused", () => {
  const kp = Keypair.generate();
  const tx = orderTransaction({ wallet: kp.publicKey, nonceAccount: Keypair.generate().publicKey, nonceValue: blockhash(), sale: sale(kp.publicKey), fee: [] });
  const expected = { wallet: kp.publicKey.toBase58(), messageHash: messageHash(tx.message.serialize()) };
  tx.sign([kp]);
  const ok = verifySignedOrder(Buffer.from(tx.serialize()).toString("base64"), expected);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.signature, bs58.encode(tx.signatures[0]));

  // A wallet that adds an instruction (e.g. its own guard) before signing: a different message — never stored.
  const modified = orderTransaction({ wallet: kp.publicKey, nonceAccount: Keypair.generate().publicKey, nonceValue: tx.message.recentBlockhash, sale: [...sale(kp.publicKey), ...sale(kp.publicKey)], fee: [] });
  modified.sign([kp]);
  const r = verifySignedOrder(Buffer.from(modified.serialize()).toString("base64"), expected);
  assert.deepEqual(r, { ok: false, reason: "modified" });
});

test("submission check: someone else's signature, an unsigned transaction, or garbage → refused", () => {
  const kp = Keypair.generate();
  const tx = orderTransaction({ wallet: kp.publicKey, nonceAccount: Keypair.generate().publicKey, nonceValue: blockhash(), sale: sale(kp.publicKey), fee: [] });
  const expected = { wallet: kp.publicKey.toBase58(), messageHash: messageHash(tx.message.serialize()) };
  assert.deepEqual(verifySignedOrder(Buffer.from(tx.serialize()).toString("base64"), expected), { ok: false, reason: "bad_signature" });
  const forged = new VersionedTransaction(tx.message);
  forged.signatures[0] = Keypair.generate().secretKey.slice(0, 64); // 64 bytes that are not a valid signature of this message
  assert.deepEqual(verifySignedOrder(Buffer.from(forged.serialize()).toString("base64"), expected), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifySignedOrder(Buffer.from(tx.serialize()).toString("base64"), { ...expected, wallet: Keypair.generate().publicKey.toBase58() }), { ok: false, reason: "wrong_signer" });
  assert.deepEqual(verifySignedOrder("not base64 at all", expected), { ok: false, reason: "unreadable" });
  assert.deepEqual(verifySignedOrder(42, expected), { ok: false, reason: "unreadable" });
});

test("nonce accounts are derived from the wallet (no extra keypair) and set up / closed with the wallet as authority", async () => {
  const wallet = Keypair.generate().publicKey;
  const a0 = await nonceAddress(wallet, 0);
  assert.ok(a0.equals(await nonceAddress(wallet, 0)), "deterministic");
  assert.ok(!a0.equals(await nonceAddress(wallet, 1)));
  const setup = setupInstructions(wallet, [{ address: a0, seed: "panda-nonce-0" }], 1_000_000);
  assert.equal(setup.length, 2);
  assert.ok(setup.every((i) => i.programId.equals(SystemProgram.programId)));
  const close = closeInstructions(wallet, [{ address: a0, lamports: 1_000_000 }]);
  assert.equal(close.length, 1);
  assert.ok(close[0].keys.some((k) => k.pubkey.equals(wallet) && k.isSigner), "only the wallet can close it");
});

test("parseNonce: only an initialised System-owned 80-byte account is a nonce", () => {
  const authority = Keypair.generate().publicKey;
  const value = Keypair.generate().publicKey;
  const data = Buffer.alloc(80);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(1, 4);
  authority.toBuffer().copy(data, 8);
  value.toBuffer().copy(data, 40);
  data.writeBigUInt64LE(BigInt(5000), 72);
  const parsed = parseNonce("X", { data, owner: SystemProgram.programId, lamports: 1_056_640, executable: false, rentEpoch: 0 });
  assert.equal(parsed?.authority, authority.toBase58());
  assert.equal(parsed?.nonce, value.toBase58());
  assert.equal(parseNonce("X", null), null);
  assert.equal(parseNonce("X", { data, owner: Keypair.generate().publicKey, lamports: 1, executable: false, rentEpoch: 0 }), null);
});

test("signed orders are stored encrypted, bound to their own order id, and unreadable without the key", () => {
  const bytes = randomBytes(900);
  assert.equal(hasOrdersKey(KEY_ENV), true);
  assert.equal(hasOrdersKey({}), false);
  assert.equal(hasOrdersKey({ PANDA_ORDERS_KEY: Buffer.alloc(16).toString("base64") }), false);
  const sealed = sealTx("order-1", bytes, KEY_ENV)!;
  assert.ok(!sealed.ciphertext.includes(Buffer.from(bytes).toString("base64").slice(0, 20)));
  assert.deepEqual(Buffer.from(openTx("order-1", sealed, KEY_ENV)!), bytes);
  assert.equal(openTx("order-2", sealed, KEY_ENV), null, "moved onto another order: refused");
  assert.equal(openTx("order-1", sealed, { PANDA_ORDERS_KEY: randomBytes(32).toString("base64") }), null, "wrong key");
  assert.equal(openTx("order-1", { ...sealed, ciphertext: Buffer.from("tampered").toString("base64") + sealed.ciphertext.slice(12) }, KEY_ENV), null);
  assert.equal(sealTx("order-1", bytes, {}), null);
});

test("sizes: a setup transaction for SETUP_PER_TX accounts and a close of 10 accounts both fit in one Solana transaction", async () => {
  const { Transaction } = await import("@solana/web3.js");
  const { SETUP_PER_TX } = await import("./service");
  const wallet = Keypair.generate().publicKey;
  const accounts = await Promise.all(Array.from({ length: SETUP_PER_TX }, async (_, i) => ({ address: await nonceAddress(wallet, 60 + i), seed: `panda-nonce-${60 + i}` })));
  const setup = new Transaction({ feePayer: wallet, recentBlockhash: blockhash() }).add(...setupInstructions(wallet, accounts, 1_056_640));
  assert.ok(setup.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232);
  const close = new Transaction({ feePayer: wallet, recentBlockhash: blockhash() }).add(...closeInstructions(wallet, Array.from({ length: 10 }, () => ({ address: Keypair.generate().publicKey, lamports: 1 }))));
  assert.ok(close.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232);
});
