import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { SESSION_COOKIE, cookieOptions, getSession, issueSession, renewSession, revokeCurrentSession } from "./session";
import { createSessionToken, readSessionToken, RENEW_AFTER_MS, SESSION_TTL_MS, USER_SESSION_TTL_MS } from "./wallet-auth";
import { renewDue, sessionTtlFor } from "./admin-policy";
import { pgCreateSession, pgSessionStatus } from "@/lib/db/sessions";

const SECRET = "s".repeat(48);
const USER = "1".repeat(43), ADMIN = "2".repeat(43), OTHER = "3".repeat(43);
let db: Db;
before(async () => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  process.env.ADMIN_WALLETS = ADMIN;
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

/** A session signed in `ago` ms ago (postgres row + cookie), as if time had passed. */
async function oldSession(wallet: string, ago: number, ttl = USER_SESSION_TTL_MS) {
  const jti = crypto.randomUUID();
  const iat = Date.now() - ago;
  await pgCreateSession(db, { jti, wallet, issuedAt: iat, expiresAt: iat + ttl });
  return { jti, iat, req: reqWith(createSessionToken(wallet, SECRET, iat, ttl, jti)) };
}

test("a normal wallet signs in for 7 days, an ADMIN_WALLETS wallet for 2 hours", async () => {
  mode("postgres");
  for (const [wallet, ttl] of [[USER, USER_SESSION_TTL_MS], [ADMIN, SESSION_TTL_MS]] as const) {
    const res = NextResponse.json({});
    await issueSession(res, wallet);
    const c = res.cookies.get(SESSION_COOKIE)!;
    assert.equal(c.maxAge, ttl / 1000, wallet);
    const parsed = readSessionToken(c.value, SECRET, Date.now())!;
    assert.ok(Math.abs(parsed.expiresAt - parsed.issuedAt - ttl) < 5);
  }
  assert.equal(USER_SESSION_TTL_MS, 7 * 24 * 3600_000);
  assert.deepEqual(sessionTtlFor(ADMIN, ADMIN, { admin: 1, user: 2 }), { ttlMs: 1, renewable: false });
  assert.deepEqual(sessionTtlFor(USER, ADMIN, { admin: 1, user: 2 }), { ttlMs: 2, renewable: true });
});

test("the cookie is always HttpOnly and SameSite=Strict, and Secure in production", async () => {
  const res = NextResponse.json({});
  await issueSession(res, USER);
  const c = res.cookies.get(SESSION_COOKIE)!;
  assert.equal(c.httpOnly, true);
  assert.equal(c.sameSite, "strict");
  const env = process.env as Record<string, string | undefined>;
  const was = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    assert.equal(cookieOptions(60).secure, true);
  } finally {
    env.NODE_ENV = was;
  }
});

test("using the site renews a normal session 7 days forward — same session, same sign-in time, at most once an hour", async () => {
  mode("postgres");
  const s = await oldSession(USER, 3 * 24 * 3600_000); // signed in 3 days ago
  const res = NextResponse.json({});
  assert.equal(await renewSession(s.req, res, USER), "renewed");
  const token = res.cookies.get(SESSION_COOKIE)!.value;
  const parsed = readSessionToken(token, SECRET, Date.now())!;
  assert.equal(parsed.jti, s.jti, "the same session");
  assert.equal(parsed.issuedAt, s.iat, "the sign-in time is never moved (admin freshness can't be faked by a renewal)");
  assert.ok(parsed.expiresAt > Date.now() + USER_SESSION_TTL_MS - 60_000);
  assert.equal(await pgSessionStatus(db, s.jti, USER, Date.now() + 5 * 24 * 3600_000), "active", "the server-side expiry moved too");
  // Renewed a moment ago: nothing to do.
  assert.equal(await renewSession(reqWith(token), NextResponse.json({}), USER), "fresh");
  assert.equal(renewDue(Date.now() + USER_SESSION_TTL_MS, USER_SESSION_TTL_MS, Date.now() + RENEW_AFTER_MS, RENEW_AFTER_MS), true);
});

test("an admin's 2-hour session is never renewed", async () => {
  mode("postgres");
  const s = await oldSession(ADMIN, 90 * 60_000, SESSION_TTL_MS);
  const res = NextResponse.json({});
  assert.equal(await renewSession(s.req, res, ADMIN), "admin");
  assert.equal(res.cookies.get(SESSION_COOKIE), undefined);
});

test("a different wallet connected: the session is reported for closing; a revoked one is never revived", async () => {
  mode("postgres");
  const s = await oldSession(USER, 2 * 3600_000);
  assert.equal(await renewSession(s.req, NextResponse.json({}), OTHER), "other_wallet");
  await revokeCurrentSession(s.req, "logout");
  const res = NextResponse.json({});
  assert.equal(await renewSession(s.req, res, USER), "none");
  assert.equal(res.cookies.get(SESSION_COOKIE), undefined);
  assert.equal(await getSession(s.req), null);
});
