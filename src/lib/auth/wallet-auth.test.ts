import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  buildSignInMessage,
  consumeNonce,
  createSessionToken,
  verifyEd25519,
  verifySessionToken,
  NonceRecord,
} from "./wallet-auth";

const SECRET = "x".repeat(40);

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  return { pub, sign: (m: Uint8Array) => new Uint8Array(sign(null, m, privateKey)) };
}

const msg = (over: Partial<Parameters<typeof buildSignInMessage>[0]> = {}) =>
  buildSignInMessage({ domain: "panda.test", wallet: "W", nonce: "n1", issuedAt: 1000, expiresAt: 2000, ...over });

test("valid signature verifies; tampered message, wrong key and bad lengths do not", () => {
  const a = keypair();
  const b = keypair();
  const m = new TextEncoder().encode(msg());
  const sig = a.sign(m);
  assert.equal(verifyEd25519(m, sig, a.pub), true);
  assert.equal(verifyEd25519(new TextEncoder().encode(msg({ domain: "evil.test" })), sig, a.pub), false);
  assert.equal(verifyEd25519(new TextEncoder().encode(msg({ nonce: "n2" })), sig, a.pub), false);
  assert.equal(verifyEd25519(m, sig, b.pub), false);
  assert.equal(verifyEd25519(m, sig.subarray(0, 63), a.pub), false);
  assert.equal(verifyEd25519(m, sig, a.pub.subarray(0, 31)), false);
  assert.equal(verifyEd25519(m, new Uint8Array(64), a.pub), false);
});

test("message binds domain, wallet, nonce and expiry", () => {
  const base = msg();
  for (const other of [msg({ domain: "x" }), msg({ wallet: "X" }), msg({ nonce: "z" }), msg({ expiresAt: 3000 })]) {
    assert.notEqual(other, base);
  }
});

test("nonce: single use, right wallet, not expired, must exist", () => {
  const rec: NonceRecord = { wallet: "W", issuedAt: 0, expiresAt: 1000, used: false };
  const first = consumeNonce(rec, "W", 500);
  assert.equal(first.ok, true);
  assert.equal(first.next?.used, true);
  assert.equal(consumeNonce(first.next, "W", 500).ok, false, "replay");
  assert.equal(consumeNonce(rec, "OTHER", 500).ok, false, "wrong wallet");
  assert.equal(consumeNonce(rec, "W", 1001).ok, false, "expired");
  assert.equal(consumeNonce(null, "W", 500).ok, false, "unknown nonce");
});

test("session token round-trips for its wallet", () => {
  const t = createSessionToken("WALLET", SECRET, 1000, 5000);
  assert.equal(verifySessionToken(t, SECRET, 2000), "WALLET");
});

test("session token is rejected when expired, forged, tampered or under another secret", () => {
  const t = createSessionToken("WALLET", SECRET, 1000, 5000);
  assert.equal(verifySessionToken(t, SECRET, 6000), null, "expired");
  assert.equal(verifySessionToken(t, "y".repeat(40), 2000), null, "wrong secret");
  const [body, sig] = t.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ w: "ATTACKER", iat: 1000, exp: 99999999 })).toString("base64url");
  assert.equal(verifySessionToken(`${forgedBody}.${sig}`, SECRET, 2000), null, "swapped payload");
  assert.equal(verifySessionToken(`${body}.${sig}x`, SECRET, 2000), null, "tampered sig");
  for (const bad of ["", "abc", "a.b.c", undefined, null]) assert.equal(verifySessionToken(bad, SECRET, 2000), null);
});

test("missing or short secret fails closed", () => {
  assert.throws(() => createSessionToken("W", "short", 0));
  const t = createSessionToken("W", SECRET, 0, 1000);
  assert.equal(verifySessionToken(t, "", 1), null);
  assert.equal(verifySessionToken(t, "short", 1), null);
});
