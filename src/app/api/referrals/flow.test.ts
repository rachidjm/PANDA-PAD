import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgSetRecruiterCode } from "@/lib/db/fee-tier";
import { canApplyRecruiterCode } from "@/lib/referrals/bind";
import { buildSignInMessage } from "@/lib/auth/wallet-auth";
import { storeNonce } from "@/lib/auth/session";
import { POST as verifyPOST } from "@/app/api/auth/verify/route";
import { POST as bindPOST } from "./bind/route";
import { GET as inviteesGET } from "./invitees/route";
import { GET as statusGET } from "./status/route";

/**
 * The whole invitee path through the real route handlers, on a real (in-process) database: apply a recruiter's
 * code, sign in, and the recruiter's invitee list shows the wallet with 0 $ of volume. Plus the path where the
 * anti-abuse check can't finish yet: the invitee sees "verifying", the recruiter sees "pending", and the binding
 * completes on the invitee's next visit with the code never typed again.
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
  process.env.SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
  delete process.env.PANDA_STORAGE_MODES;
});

const REAL_FETCH = globalThis.fetch;

/** Replaces the global fetch (the anti-abuse check runs through it) for the duration of `fn`. */
async function withFunderCheck<T>(response: "clean" | "unknown", referred: string, fn: () => Promise<T>): Promise<T> {
  globalThis.fetch = (async () =>
    response === "clean"
      ? { ok: true, json: async () => [{ nativeTransfers: [{ fromUserAccount: "SomeoneElse", toUserAccount: referred, amount: 500 }] }] }
      : { ok: false, json: async () => [] }) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
}

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  return { wallet: bs58.encode(pub), sign: (m: Uint8Array) => new Uint8Array(nodeSign(null, m, privateKey)) };
}

async function signIn(wallet: string, sign: (m: Uint8Array) => Uint8Array, extra: Record<string, unknown> = {}) {
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
  const res = await verifyPOST(req);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { body: (await res.json()) as Record<string, unknown>, cookie };
}

type InviteeRow = { wallet: string; state: string; source: string; code: string | null; tradedVolumeUsd: number; streakDays: number };

async function listInvitees(referrer: string): Promise<InviteeRow[]> {
  const res = await inviteesGET(new Request(`https://panda.test/api/referrals/invitees?wallet=${referrer}`));
  return ((await res.json()) as { invitees: InviteeRow[] }).invitees;
}

async function inviteeStatus(wallet: string) {
  const res = await statusGET(new Request(`https://panda.test/api/referrals/status?wallet=${wallet}`));
  return (await res.json()) as { state: string; referrer?: string; source?: string; code?: string | null };
}

test("flow: apply a code, sign in, and the recruiter's invitee list shows the wallet with 0 $ of volume", async () => {
  const referrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, referrer, "flowcode1", Date.now());
  const { wallet, sign } = signer();

  const { body } = await withFunderCheck("clean", wallet, () => signIn(wallet, sign, { code: "flowcode1" }));
  assert.equal(body.codeBound, true);

  const row = (await listInvitees(referrer)).find((i) => i.wallet === wallet);
  assert.ok(row, "the invitee is listed");
  assert.equal(row.state, "bound");
  assert.equal(row.source, "code");
  assert.equal(row.code, "flowcode1");
  assert.equal(row.tradedVolumeUsd, 0, "no trades yet, still listed");
  assert.equal(row.streakDays, 0);
});

test("flow: the invitee's own status says who invited it and through which code", async () => {
  const referrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, referrer, "flowcode2", Date.now());
  const { wallet, sign } = signer();
  await withFunderCheck("clean", wallet, () => signIn(wallet, sign, { code: "flowcode2" }));

  const status = await inviteeStatus(wallet);
  assert.equal(status.state, "bound");
  assert.equal(status.referrer, referrer);
  assert.equal(status.source, "code");
  assert.equal(status.code, "flowcode2");
});

test("flow: an inconclusive check is listed as pending, then completes on the next visit without the code being typed again", async () => {
  const referrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, referrer, "flowcode3", Date.now());
  const { wallet, sign } = signer();

  // First sign-in: the funder check can't finish, so there is no codeBound answer and the client keeps the code.
  const first = await withFunderCheck("unknown", wallet, () => signIn(wallet, sign, { code: "flowcode3" }));
  assert.equal("codeBound" in first.body, false, "not terminal: the client must keep the code");
  assert.equal(await canApplyRecruiterCode(wallet), false, "no second code field while verification is pending");

  let row = (await listInvitees(referrer)).find((i) => i.wallet === wallet);
  assert.equal(row?.state, "pending");
  assert.equal((await inviteeStatus(wallet)).state, "pending");

  // Next visit: the session already exists, so the client calls /bind (no signature) with the same pending code.
  const bind = await withFunderCheck("clean", wallet, () =>
    bindPOST(
      new Request("https://panda.test/api/referrals/bind", {
        method: "POST",
        headers: { "content-type": "application/json", host: "panda.test", cookie: first.cookie },
        body: JSON.stringify({ wallet, code: "flowcode3" }),
      })
    )
  );
  assert.equal(bind.status, 200);
  assert.equal(((await bind.json()) as { codeBound?: boolean }).codeBound, true);

  const list = await listInvitees(referrer);
  row = list.find((i) => i.wallet === wallet);
  assert.equal(row?.state, "bound", "the pending attempt became a binding");
  assert.equal(list.filter((i) => i.wallet === wallet).length, 1, "no duplicate row");
  assert.equal(row?.code, "flowcode3");
});

test("flow: a self-funded invitee is listed as rejected for the recruiter, and the invitee never sees why", async () => {
  const referrer = Keypair.generate().publicKey.toBase58();
  await pgSetRecruiterCode(db, referrer, "flowcode4", Date.now());
  const { wallet, sign } = signer();
  // The referrer funded the invitee's first transfer: the check rejects it.
  globalThis.fetch = (async () => ({ ok: true, json: async () => [{ nativeTransfers: [{ fromUserAccount: referrer, toUserAccount: wallet, amount: 500 }] }] })) as unknown as typeof fetch;
  let body: Record<string, unknown>;
  try {
    ({ body } = await signIn(wallet, sign, { code: "flowcode4" }));
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
  assert.equal(body.codeBound, false);

  const row = (await listInvitees(referrer)).find((i) => i.wallet === wallet);
  assert.equal(row?.state, "rejected");
  assert.equal((await inviteeStatus(wallet)).state, "none");
});

test("flow: /bind refuses a wallet without its own signed session", async () => {
  const { wallet } = signer();
  const res = await bindPOST(
    new Request("https://panda.test/api/referrals/bind", { method: "POST", headers: { "content-type": "application/json", host: "panda.test" }, body: JSON.stringify({ wallet, code: "x" }) })
  );
  assert.equal(res.status, 401);
});
