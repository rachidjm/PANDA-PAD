import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptSecretKey, encryptSecretKey, hasVanityStockKey } from "./crypto";

const KEY = randomBytes(32).toString("base64");
const ENV = { VANITY_STOCK_KEY: KEY };

test("round-trips a real 64-byte secret key exactly", () => {
  const secret = randomBytes(64);
  const enc = encryptSecretKey(secret, ENV);
  assert.ok(enc);
  const dec = decryptSecretKey(enc!, ENV);
  assert.deepEqual(dec, new Uint8Array(secret));
});

test("null (never throws) without a configured key", () => {
  assert.equal(encryptSecretKey(randomBytes(64), {}), null);
  assert.equal(decryptSecretKey({ ciphertext: "abc", nonce: "def" }, {}), null);
  assert.equal(hasVanityStockKey({}), false);
  assert.equal(hasVanityStockKey({ VANITY_STOCK_KEY: "not 32 bytes" }), false);
  assert.equal(hasVanityStockKey(ENV), true);
});

test("decrypting with the wrong key fails closed (authenticated encryption — never returns garbage)", () => {
  const enc = encryptSecretKey(randomBytes(64), ENV)!;
  const wrongKey = { VANITY_STOCK_KEY: randomBytes(32).toString("base64") };
  assert.equal(decryptSecretKey(enc, wrongKey), null);
});

test("a tampered ciphertext fails closed", () => {
  const enc = encryptSecretKey(randomBytes(64), ENV)!;
  const tampered = { ...enc, ciphertext: Buffer.from(enc.ciphertext, "base64").fill(0, 0, 1).toString("base64") };
  assert.equal(decryptSecretKey(tampered, ENV), null);
});
