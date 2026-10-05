import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgSetRecruiterCode } from "@/lib/db/fee-tier";
import { pgGetReferrer } from "@/lib/db/referrals";
import { buildSignInMessage } from "@/lib/auth/wallet-auth";
import { storeNonce } from "@/lib/auth/session";
import { POST } from "./route";

/**
 * End-to-end through the real route handler (same pattern as admin-lockdown.test.ts): a real nonce, a real
 * signature, a real PGlite database — this is the one place the NEW `code` handling (mirrors the existing
 * `ref` handling right next to it) actually gets exercised, since it's a thin pass-through to
 * tryApplyRecruiterCode (already covered on its own in bind.test.ts) wired into the sign-in response.
 */

let db: Db;
const SAVED = { ...process.env };
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => {
  setDbForTests(null);
  process.env = SAVED;
});
beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = "s".repeat(40);
  process.env.FEATURE_REFERRALS = "true";
  process.env.SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=test-key"; // firstFunderCheck needs an api-key to even attempt a lookup
  delete process.env.PANDA_STORAGE_MODES; // nonces/sessions fall back to in-process memory without a Blob token — fine for this test
});

/** tryApplyRecruiterCode/tryBindReferral run the real anti-abuse check (firstFunderCheck) against the real
 *  `fetch` inside the route — unlike bind.test.ts, which can pass a mock fetchImpl straight into the function
 *  under test, this route always uses the global one. Swapping it for the test's duration is the only way to
 *  get a deterministic "clean" (never self-funded) verdict instead of a real network call. */
const REAL_FETCH = globalThis.fetch;
function withCleanFunder<T>(referred: string, fn: () => Promise<T>): Promise<T> {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => [{ nativeTransfers: [{ fromUserAccount: "SomeoneElse", toUserAccount: referred, amount: 500 }] }],
  })) as unknown as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = REAL_FETCH;
  });
}

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  return { wallet: bs58.encode(pub), sign: (m: Uint8Array) => new Uint8Array(nodeSign(null, m, privateKey)) };
}

/** Issues a real nonce for `wallet`, signs the exact message the route itself will rebuild, and POSTs — this
 *  is the full sign-in round-trip, just skipping the separate /api/auth/challenge call (same nonce mechanism). */
async function verify(wallet: string, sign: (m: Uint8Array) => Uint8Array, extra: Record<string, unknown> = {}) {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 5 * 60_000;
  await storeNonce(nonce, { wallet, issuedAt, expiresAt, used: false });
  const message = buildSignInMessage({ domain: "panda.test", wallet, nonce, issuedAt, expiresAt });
  const signature = bs58.encode(sign(new TextEncoder().encode(message)));
  const req = new Request("https://panda.test/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json", host: "panda.test" },
    body: JSON.stringify({ wallet, nonce, signature, ...extra }),
  });
  const res = await POST(req);
  return { res, body: await res.json() };
}

test("verify: a valid code for a real recruiter binds the wallet to its owner, and reports codeBound: true", async () => {
  const referrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, referrer, "myrecruiter", Date.now());
  const { wallet, sign } = signer();

  const { res, body } = await withCleanFunder(wallet, () => verify(wallet, sign, { code: "myrecruiter" }));
  assert.equal(res.status, 200);
  assert.equal(body.codeBound, true);
  assert.equal(await pgGetReferrer(db, wallet), referrer);
});

test("verify: an unknown code never binds anything, but still reports a terminal codeBound: false (not left pending forever)", async () => {
  const { wallet, sign } = signer();
  const { res, body } = await verify(wallet, sign, { code: "doesnotexist" });
  assert.equal(res.status, 200);
  assert.equal(body.codeBound, false);
  assert.equal(await pgGetReferrer(db, wallet), null);
});

test("verify: no `code` in the body means no codeBound field at all — sign-in itself is unaffected either way", async () => {
  const { wallet, sign } = signer();
  const { res, body } = await verify(wallet, sign);
  assert.equal(res.status, 200);
  assert.equal("codeBound" in body, false);
  assert.equal(body.wallet, wallet);
});

test("verify: ref and code together — ref wins (first-touch is still a wallet-address link, not a code), code becomes a harmless no-op", async () => {
  const linkReferrer = Keypair.generate().publicKey.toBase58();
  const codeReferrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, codeReferrer, "othercode", Date.now());
  const { wallet, sign } = signer();

  const { res, body } = await withCleanFunder(wallet, () => verify(wallet, sign, { ref: linkReferrer, code: "othercode" }));
  assert.equal(res.status, 200);
  assert.equal(body.refBound, true);
  assert.equal(body.codeBound, false, "already_bound (to the ref) is terminal, not a real rejection of the code itself");
  assert.equal(await pgGetReferrer(db, wallet), linkReferrer, "the link wins, never silently overwritten by the code");
});

test("verify: FEATURE_REFERRALS off — sign-in still succeeds, but a code never binds", async () => {
  process.env.FEATURE_REFERRALS = "false";
  const referrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, referrer, "stillthere", Date.now());
  const { wallet, sign } = signer();

  const { res, body } = await verify(wallet, sign, { code: "stillthere" });
  assert.equal(res.status, 200);
  assert.equal(body.codeBound, false);
  assert.equal(await pgGetReferrer(db, wallet), null);
});
