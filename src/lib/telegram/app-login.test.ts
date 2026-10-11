import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { telegramUsers } from "@/lib/db/schema";
import { pgSessionStatus } from "@/lib/db/sessions";
import { tgUnlinkWallet } from "@/lib/db/telegram";
import { consumeNonce, type NonceRecord } from "@/lib/auth/wallet-auth";
import { APP_INIT_DATA_HEADER, APP_SESSION_HEADER, APP_SESSION_TTL_MS, appWalletSession, closeAppLogin, completeAppLogin, readAppToken, resumeAppLogin, startAppLogin, type LoginDeps } from "./app-login";
import { newUserId } from "./testing";
import { readFileSync } from "node:fs";

/**
 * The Mini App's PANDA session: valid only while the app is open (closing it ends it on the server), only for the wallet
 * linked to that Telegram account, only with Telegram's own signed data for that same account — and a trip to the
 * wallet app never loses it.
 */

const TOKEN = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DOMAIN = "launchonpanda.app";
const T0 = 1_800_000_000_000;

function signInitData(telegramId: number, at: number, token = TOKEN): string {
  const fields: Record<string, string> = { auth_date: String(Math.floor(at / 1000)), query_id: "AAE1", user: JSON.stringify({ id: telegramId, first_name: "Ana", language_code: "es" }) };
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
}

let db: Db;
before(async () => {
  db = await newTestDb();
});

function world() {
  const clock = { t: T0 };
  const memory = new Map<string, NonceRecord>();
  const d: LoginDeps = {
    db,
    now: () => clock.t,
    botToken: TOKEN,
    nonces: {
      store: async (n, r) => void memory.set(n, r),
      read: async (n) => memory.get(n) ?? null,
      burn: async (n, w) => {
        const r = consumeNonce(memory.get(n) ?? null, w, clock.t);
        if (r.next) memory.set(n, r.next);
        return r.ok;
      },
    },
  };
  return { d, clock };
}

async function linkedUser() {
  const keys = nacl.sign.keyPair();
  const wallet = bs58.encode(keys.publicKey);
  const telegramId = newUserId() + 500_000;
  await db.insert(telegramUsers).values({ telegramId, lang: "es", wallet, linkedAt: T0, createdAt: T0, updatedAt: T0 });
  const sign = (message: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keys.secretKey));
  return { telegramId, wallet, sign };
}

async function signedIn() {
  const w = world();
  const u = await linkedUser();
  const c = await startAppLogin(w.d, u.telegramId, DOMAIN);
  assert.ok(c.ok);
  const login = await completeAppLogin(w.d, { telegramId: u.telegramId, nonce: c.nonce, signature: u.sign(c.message), domain: DOMAIN });
  assert.ok(login.ok);
  return { ...w, u, login, initData: signInitData(u.telegramId, T0 - 5_000) };
}

test("signing in: PANDA's own sign-in message, for the wallet linked to that Telegram account, signed by that wallet", async () => {
  const { d } = world();
  const u = await linkedUser();
  const c = await startAppLogin(d, u.telegramId, DOMAIN);
  assert.ok(c.ok);
  assert.equal(c.wallet, u.wallet);
  assert.match(c.message, /^PANDA wants you to sign in with your Solana wallet\./);
  assert.ok(c.message.includes(`Wallet: ${u.wallet}`) && c.message.includes(`Domain: ${DOMAIN}`));

  const login = await completeAppLogin(d, { telegramId: u.telegramId, nonce: c.nonce, signature: u.sign(c.message), domain: DOMAIN });
  assert.ok(login.ok);
  assert.equal(login.wallet, u.wallet);
  assert.equal(login.expiresAt, T0 + APP_SESSION_TTL_MS);
  assert.ok(APP_SESSION_TTL_MS <= 6 * 3_600_000, "a few hours at most");
  assert.deepEqual(readAppToken(login.token, TOKEN, T0), { jti: login.jti, telegramId: u.telegramId, wallet: u.wallet, expiresAt: login.expiresAt });

  // One signature, one sign-in.
  assert.deepEqual(await completeAppLogin(d, { telegramId: u.telegramId, nonce: c.nonce, signature: u.sign(c.message), domain: DOMAIN }), { ok: false, error: "invalid" });
});

test("no linked wallet: there is nothing to sign in with", async () => {
  const { d } = world();
  const telegramId = newUserId() + 500_000;
  assert.deepEqual(await startAppLogin(d, telegramId, DOMAIN), { ok: false, error: "not_linked" });
  assert.deepEqual(await completeAppLogin(d, { telegramId, nonce: "0".repeat(32), signature: "x", domain: DOMAIN }), { ok: false, error: "not_linked" });
});

test("another wallet's signature, another account's challenge, another site's message and a late signature are all refused", async () => {
  const { d, clock } = world();
  const u = await linkedUser();
  const other = await linkedUser();

  // Signed by a wallet that isn't the linked one.
  const c1 = await startAppLogin(d, u.telegramId, DOMAIN);
  assert.ok(c1.ok);
  assert.deepEqual(await completeAppLogin(d, { telegramId: u.telegramId, nonce: c1.nonce, signature: other.sign(c1.message), domain: DOMAIN }), { ok: false, error: "invalid" });
  // Another Telegram account presenting this account's challenge (its own linked wallet doesn't match the challenge's).
  assert.deepEqual(await completeAppLogin(d, { telegramId: other.telegramId, nonce: c1.nonce, signature: other.sign(c1.message), domain: DOMAIN }), { ok: false, error: "invalid" });
  // The same words signed for another site.
  assert.deepEqual(await completeAppLogin(d, { telegramId: u.telegramId, nonce: c1.nonce, signature: u.sign(c1.message), domain: "evil.example" }), { ok: false, error: "invalid" });
  // Too late.
  const c2 = await startAppLogin(d, u.telegramId, DOMAIN);
  assert.ok(c2.ok);
  clock.t = c2.expiresAt + 1;
  assert.deepEqual(await completeAppLogin(d, { telegramId: u.telegramId, nonce: c2.nonce, signature: u.sign(c2.message), domain: DOMAIN }), { ok: false, error: "invalid" });
  // Garbage.
  for (const bad of [{ nonce: "nope", signature: "x" }, { nonce: c1.nonce, signature: 5 }, { nonce: c1.nonce, signature: "0OIl" }]) {
    assert.equal((await completeAppLogin(d, { telegramId: u.telegramId, ...bad, domain: DOMAIN })).ok, false);
  }
});

test("every request: the session, Telegram's signed data for the same account, the live row and the linked wallet", async () => {
  const { d, clock, u, login, initData } = await signedIn();
  const s = await appWalletSession(d, login.token, initData);
  assert.deepEqual(s, { wallet: u.wallet, telegramId: u.telegramId, jti: login.jti, issuedAt: T0 });

  // Without Telegram's data, with data that fails its signature, or with another account's data: no session.
  assert.equal(await appWalletSession(d, login.token, null), null);
  assert.equal(await appWalletSession(d, login.token, signInitData(u.telegramId, T0, "999:other-bot-token")), null);
  const stranger = await linkedUser();
  assert.equal(await appWalletSession(d, login.token, signInitData(stranger.telegramId, T0)), null);
  // A token that was altered — another wallet, another account, a later expiry — fails its own signature.
  const parts = login.token.split(".");
  for (const [i, v] of [[2, String(stranger.telegramId)], [3, stranger.wallet], [4, String(login.expiresAt + 1)]] as const) {
    const forged = parts.map((p, k) => (k === i ? v : p)).join(".");
    assert.equal(readAppToken(forged, TOKEN, T0), null);
    assert.equal(await appWalletSession(d, forged, initData), null);
  }
  assert.equal(await appWalletSession(d, "nonsense", initData), null);

  // It lasts while the app is open — but never more than its few hours, even if the app is never closed.
  clock.t = T0 + APP_SESSION_TTL_MS - 60_000;
  assert.ok(await appWalletSession(d, login.token, initData));
  clock.t = T0 + APP_SESSION_TTL_MS + 1;
  assert.equal(await appWalletSession(d, login.token, initData), null);
});

test("closing the app ends the session on the server: the same token is refused afterwards, and nothing brings it back", async () => {
  const { d, login, initData, u } = await signedIn();
  assert.ok(await appWalletSession(d, login.token, initData));
  assert.equal(await closeAppLogin(d, login.token), true);
  assert.equal(await appWalletSession(d, login.token, initData), null);
  assert.equal(await pgSessionStatus(db, login.jti, u.wallet, T0), "revoked");
  assert.deepEqual(await resumeAppLogin(d, { telegramId: u.telegramId, jti: login.jti, resume: login.resume }), { ok: false, error: "invalid" });
  assert.equal(await closeAppLogin(d, login.token), false);
  assert.equal(await closeAppLogin(d, "nonsense"), false);
});

test("unlinking the wallet (or linking another) ends the session at once", async () => {
  const { d, login, initData, u } = await signedIn();
  await tgUnlinkWallet(db, u.telegramId, T0);
  assert.equal(await appWalletSession(d, login.token, initData), null);
  assert.equal((await resumeAppLogin(d, { telegramId: u.telegramId, jti: login.jti, resume: login.resume })).ok, false);
});

test("back from the wallet: the session is still there, and if Telegram restarted the app the one-time ticket returns the same one", async () => {
  const { d, clock, login, initData, u } = await signedIn();
  // Two minutes in the wallet app: nothing was closed, the session simply still works.
  clock.t = T0 + 2 * 60_000;
  assert.ok(await appWalletSession(d, login.token, initData));

  // Telegram started the app again (new initData, empty memory): the ticket brings back the SAME session, same expiry.
  const fresh = signInitData(u.telegramId, clock.t);
  const back = await resumeAppLogin(d, { telegramId: u.telegramId, jti: login.jti, resume: login.resume });
  assert.ok(back.ok);
  assert.equal(back.jti, login.jti);
  assert.equal(back.expiresAt, login.expiresAt);
  assert.deepEqual(await appWalletSession(d, back.token, fresh), { wallet: u.wallet, telegramId: u.telegramId, jti: login.jti, issuedAt: T0 });

  // The ticket works once; another account can't use one; a wrong one is refused.
  assert.equal((await resumeAppLogin(d, { telegramId: u.telegramId, jti: login.jti, resume: login.resume })).ok, false);
  const stranger = await linkedUser();
  assert.equal((await resumeAppLogin(d, { telegramId: stranger.telegramId, jti: login.jti, resume: back.resume })).ok, false);
  assert.equal((await resumeAppLogin(d, { telegramId: u.telegramId, jti: login.jti, resume: "x".repeat(32) })).ok, false);
  assert.equal((await resumeAppLogin(d, { telegramId: u.telegramId, jti: "nope", resume: back.resume })).ok, false);
  // And never past the session's own end.
  clock.t = login.expiresAt + 1;
  assert.equal((await resumeAppLogin(d, { telegramId: u.telegramId, jti: login.jti, resume: back.resume })).ok, false);
});

test("the session travels in a header and never in a cookie or in the browser's storage", () => {
  assert.equal(APP_SESSION_HEADER, "x-panda-app-session");
  assert.equal(APP_INIT_DATA_HEADER, "x-tg-init-data");
  const auth = readFileSync("src/lib/auth/session.ts", "utf8");
  assert.ok(auth.includes(`const APP_SESSION_HEADER = "${APP_SESSION_HEADER}"`), "session.ts reads the same header");
  const route = readFileSync("src/app/api/tg/login/route.ts", "utf8");
  assert.ok(!/cookies\.set|Set-Cookie/i.test(route), "the sign-in route sets no cookie");
  const client = readFileSync("src/components/tg/session.ts", "utf8");
  assert.ok(!/(localStorage|sessionStorage)[^\n]*token/i.test(client) && !/document\.cookie/.test(client), "the app keeps the session in memory only");
});
