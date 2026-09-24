import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { SESSION_COOKIE, burnNonce, getSession, issueSession, readNonce, revokeAllSessions, revokeCurrentSession, sessionsRevocable, storeNonce } from "./session";
import { createSessionToken, SESSION_TTL_MS } from "./wallet-auth";
import { pgCleanupAuth, pgCountLiveSessions, pgCreateSession, pgReadNonce, pgStoreNonce } from "@/lib/db/sessions";
import { authNonces, sessions } from "@/lib/db/schema";

const SECRET = "s".repeat(48);
const W1 = "1".repeat(43), W2 = "2".repeat(43);
let db: Db;
before(async () => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  db = await newTestDb();
});
afterEach(() => {
  delete process.env.PANDA_STORAGE_MODES;
  setDbForTests(db);
});
const mode = (m: string) => {
  process.env.PANDA_STORAGE_MODES = `sessions=${m}`;
  setDbForTests(db);
};
const reqWith = (token: string) => new Request("https://panda.test/api/x", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
async function login(wallet: string): Promise<{ token: string; req: Request; jti: string }> {
  const res = NextResponse.json({});
  const { jti } = await issueSession(res, wallet);
  const token = res.cookies.get(SESSION_COOKIE)!.value;
  return { token, req: reqWith(token), jti };
}

test("BLOB mode is today's behaviour: stateless, valid until it expires, not revocable", async () => {
  mode("blob");
  const { req } = await login(W1);
  assert.equal((await getSession(req))?.wallet, W1);
  assert.equal(sessionsRevocable(), false);
  assert.equal(await revokeCurrentSession(req), false);
  assert.equal((await getSession(req))?.wallet, W1, "logout can't end it server-side in blob mode");
  await assert.rejects(revokeAllSessions(W1, "x"), /aren't revocable/);
});

test("POSTGRES: a revoked session stops working AT ONCE (the copied cookie is dead), other sessions and other wallets are untouched", async () => {
  mode("postgres");
  const a = await login(W1), b = await login(W1), other = await login(W2);
  assert.equal((await getSession(a.req))?.wallet, W1);
  assert.equal(await revokeCurrentSession(a.req, "logout"), true);
  assert.equal(await getSession(a.req), null, "revoked: rejected immediately");
  assert.equal((await getSession(b.req))?.wallet, W1, "the same wallet's other device is still signed in");
  assert.equal(await revokeCurrentSession(a.req, "again"), false, "revoking twice is a no-op");
  assert.equal(await revokeAllSessions(W1, "close all"), 1);
  assert.equal(await getSession(b.req), null);
  assert.equal((await getSession(other.req))?.wallet, W2, "another wallet's session is not affected");
  assert.equal(await pgCountLiveSessions(db, W1, Date.now()), 0);
});

test("POSTGRES: a token is worthless without a live row — forged, expired, unknown or from before the switch", async () => {
  mode("postgres");
  const now = Date.now();
  const unknownJti = createSessionToken(W1, SECRET, now, SESSION_TTL_MS, "00000000-0000-4000-8000-000000000000");
  assert.equal(await getSession(reqWith(unknownJti)), null, "a validly signed token for a session PANDA never registered");
  const legacy = createSessionToken(W1, SECRET, now);
  assert.equal(await getSession(reqWith(legacy)), null, "a token with no session id (issued before this existed)");
  assert.equal(await getSession(reqWith(createSessionToken(W1, "x".repeat(48), now, SESSION_TTL_MS, "11111111-1111-4111-8111-111111111111"))), null, "wrong signing secret");
  const { req, jti } = await login(W1);
  await db.update(sessions).set({ expiresAt: now - 1 }).where(eq(sessions.jti, jti));
  assert.equal(await getSession(req), null, "expired in the database even though the token itself hasn't");
  const stolen = await login(W1);
  await db.update(sessions).set({ wallet: W2 }).where(eq(sessions.jti, stolen.jti));
  assert.equal(await getSession(stolen.req), null, "a jti bound to another wallet doesn't validate");
});

test("POSTGRES FAILS CLOSED: with the database down nobody is signed in, and no session can be issued", async () => {
  mode("postgres");
  const { req } = await login(W1);
  setDbForTests(null);
  delete process.env.DATABASE_URL;
  assert.equal(await getSession(req), null);
  await assert.rejects(issueSession(NextResponse.json({}), W1));
});

test("DUAL is the safe migration mode: old tokens and a database outage don't lock anyone out, but a REVOKED session is still refused", async () => {
  mode("dual");
  const legacy = createSessionToken(W1, SECRET, Date.now());
  assert.equal((await getSession(reqWith(legacy)))?.wallet, W1, "pre-switch tokens keep working while dual");
  const { req } = await login(W1);
  assert.equal((await getSession(req))?.wallet, W1);
  await revokeAllSessions(W1, "test");
  assert.equal(await getSession(req), null, "revocation is enforced in dual");
  const fresh = await login(W1);
  setDbForTests(null);
  assert.equal((await getSession(fresh.req))?.wallet, W1, "database outage in dual: no lockout");
});

test("nonces in POSTGRES: store → read → burn once; wrong wallet, expired and replays all fail", async () => {
  mode("postgres");
  const now = Date.now();
  const rec = { wallet: W1, issuedAt: now, expiresAt: now + 60_000, used: false };
  await storeNonce("a".repeat(32), rec);
  await assert.rejects(storeNonce("a".repeat(32), rec), /collision/i);
  assert.deepEqual(await readNonce("a".repeat(32)), rec);
  assert.equal(await burnNonce("a".repeat(32), W2), false, "another wallet can't burn it");
  assert.equal(await burnNonce("a".repeat(32), W1), true);
  assert.equal(await burnNonce("a".repeat(32), W1), false, "one signature, one login");
  assert.equal((await readNonce("a".repeat(32)))?.used, true);
  await storeNonce("b".repeat(32), { ...rec, expiresAt: now - 1 });
  assert.equal(await burnNonce("b".repeat(32), W1), false, "expired");
  assert.equal(await readNonce("c".repeat(32)), null);
});

test("CONCURRENCY: 25 simultaneous verifications of one nonce — exactly one wins", async () => {
  mode("postgres");
  const now = Date.now();
  await storeNonce("d".repeat(32), { wallet: W1, issuedAt: now, expiresAt: now + 60_000, used: false });
  const results = await Promise.all(Array.from({ length: 25 }, () => burnNonce("d".repeat(32), W1)));
  assert.equal(results.filter(Boolean).length, 1);
});

test("nonces in DUAL: Blob decides and Postgres mirrors both the challenge and its burn", async () => {
  mode("dual");
  const now = Date.now();
  const nonce = "e".repeat(32);
  await storeNonce(nonce, { wallet: W1, issuedAt: now, expiresAt: now + 60_000, used: false });
  assert.equal((await pgReadNonce(db, nonce))?.wallet, W1);
  assert.equal(await burnNonce(nonce, W1), true);
  assert.equal(await burnNonce(nonce, W1), false);
  assert.equal((await pgReadNonce(db, nonce))?.used, true);
});

test("CLEANUP removes expired nonces (a day after) and long-expired sessions, and never a live one", async () => {
  const d = await newTestDb();
  const now = Date.now();
  const day = 24 * 3_600_000;
  await pgStoreNonce(d, "old".padEnd(32, "0"), { wallet: W1, issuedAt: now - 3 * day, expiresAt: now - 2 * day, used: false });
  await pgStoreNonce(d, "recent".padEnd(32, "0"), { wallet: W1, issuedAt: now - 3_600_000, expiresAt: now - 60_000, used: false });
  await pgStoreNonce(d, "live".padEnd(32, "0"), { wallet: W1, issuedAt: now, expiresAt: now + 60_000, used: false });
  await pgCreateSession(d, { jti: "00000000-0000-4000-8000-000000000001", wallet: W1, issuedAt: now - 10 * day, expiresAt: now - 9 * day });
  await pgCreateSession(d, { jti: "00000000-0000-4000-8000-000000000002", wallet: W1, issuedAt: now - day, expiresAt: now - day + 1000 });
  await pgCreateSession(d, { jti: "00000000-0000-4000-8000-000000000003", wallet: W1, issuedAt: now, expiresAt: now + SESSION_TTL_MS });
  assert.deepEqual(await pgCleanupAuth(d, now), { nonces: 1, sessions: 1 });
  const left = (await d.select().from(authNonces)).map((n) => n.nonce.replace(/0+$/, ""));
  assert.deepEqual(left.sort(), ["live", "recent"]);
  assert.equal((await d.select().from(sessions)).length, 2);
  assert.equal(await pgCountLiveSessions(d, W1, now), 1);
});
