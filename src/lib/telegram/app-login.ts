import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bs58 from "bs58";
import type { Db } from "@/lib/db/client";
import { pgCreateSession, pgRevokeSession, pgSessionStatus } from "@/lib/db/sessions";
import { tgDeleteState, tgGetState, tgGetUser, tgSetState } from "@/lib/db/telegram";
import { buildSignInMessage, CHALLENGE_TTL_MS, newNonce, verifyEd25519, type NonceRecord } from "@/lib/auth/wallet-auth";
import { INIT_DATA_MAX_AGE_MS, verifyInitData } from "./miniapp";

/**
 * Signing in to PANDA inside the Telegram Mini App (docs/TELEGRAM.md §12).
 *
 * The website keeps a wallet's session in a cookie for days. The Mini App must not: its session lives only in the open
 * app's memory and ends when the app is closed. So it is a different kind of session, with the same proof behind it —
 * the wallet signs PANDA's own sign-in message — and three more conditions, checked on EVERY request:
 *
 *   1. the request carries Telegram's signed `initData`, and it names the Telegram account the session was issued to;
 *   2. the wallet is the one that account linked with /link — still, right now (unlinking ends the session);
 *   3. the session is a live, unrevoked row (closing the app revokes it) and is at most a few hours old.
 *
 * It travels in a header, never in a cookie, and is never valid for /admin (the admin gate reads the cookie alone).
 */

export const APP_SESSION_TTL_MS = 4 * 60 * 60_000;
export const APP_SESSION_HEADER = "x-panda-app-session";
export const APP_INIT_DATA_HEADER = "x-tg-init-data";

export type NonceStore = {
  store: (nonce: string, record: NonceRecord) => Promise<void>;
  read: (nonce: string) => Promise<NonceRecord | null>;
  burn: (nonce: string, wallet: string) => Promise<boolean>;
};
export type LoginDeps = { db: Db; now: () => number; botToken: string; nonces: NonceStore };

const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const tokenKey = (botToken: string) => hmac("panda-miniapp-wallet-session", botToken);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const stateKey = (jti: string) => `appsess:${jti}`;

export type AppToken = { jti: string; telegramId: number; wallet: string; expiresAt: number };
/** What the server keeps beside the session row: whose it is, and the hash of the one-time ticket that can bring it back after a wallet trip. */
type AppSessionState = { telegramId: number; wallet: string; expiresAt: number; resumeHash: string };

function makeToken(t: AppToken, botToken: string): string {
  const body = `tgw1.${t.jti}.${t.telegramId}.${t.wallet}.${t.expiresAt}`;
  return `${body}.${hmac(tokenKey(botToken), body).toString("base64url")}`;
}

export function readAppToken(token: unknown, botToken: string, now: number): AppToken | null {
  if (typeof token !== "string" || token.length > 300 || !botToken) return null;
  const m = /^(tgw1\.([0-9a-f-]{36})\.(\d{1,16})\.([1-9A-HJ-NP-Za-km-z]{32,44})\.(\d{10,16}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  if (!sameBytes(hmac(tokenKey(botToken), m[1]), Buffer.from(m[6], "base64url"))) return null;
  const telegramId = Number(m[3]);
  const expiresAt = Number(m[5]);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || expiresAt <= now) return null;
  return { jti: m[2], telegramId, wallet: m[4], expiresAt };
}

export type Challenge = { ok: true; nonce: string; message: string; wallet: string; expiresAt: number } | { ok: false; error: "not_linked" };

/** PANDA's ordinary sign-in message, for the wallet this Telegram account linked. The wallet is never taken from the request. */
export async function startAppLogin(d: LoginDeps, telegramId: number, domain: string): Promise<Challenge> {
  const wallet = (await tgGetUser(d.db, telegramId))?.wallet ?? null;
  if (!wallet) return { ok: false, error: "not_linked" };
  const nonce = newNonce();
  const issuedAt = d.now();
  const expiresAt = issuedAt + CHALLENGE_TTL_MS;
  await d.nonces.store(nonce, { wallet, issuedAt, expiresAt, used: false });
  return { ok: true, nonce, wallet, expiresAt, message: buildSignInMessage({ domain, wallet, nonce, issuedAt, expiresAt }) };
}

export type AppLogin = { ok: true; token: string; jti: string; resume: string; wallet: string; expiresAt: number } | { ok: false; error: "not_linked" | "invalid" };

/** The signature is checked against the message the server rebuilds itself, for the LINKED wallet; the nonce works once. */
export async function completeAppLogin(d: LoginDeps, i: { telegramId: number; nonce: unknown; signature: unknown; domain: string }): Promise<AppLogin> {
  const wallet = (await tgGetUser(d.db, i.telegramId))?.wallet ?? null;
  if (!wallet) return { ok: false, error: "not_linked" };
  if (typeof i.nonce !== "string" || !/^[0-9a-f]{32}$/.test(i.nonce) || typeof i.signature !== "string" || i.signature.length > 128) return { ok: false, error: "invalid" };
  const now = d.now();
  const record = await d.nonces.read(i.nonce);
  if (!record || record.used || record.wallet !== wallet || now > record.expiresAt) return { ok: false, error: "invalid" };
  let sig: Uint8Array;
  let key: Uint8Array;
  try {
    sig = bs58.decode(i.signature);
    key = bs58.decode(wallet);
  } catch {
    return { ok: false, error: "invalid" };
  }
  const message = buildSignInMessage({ domain: i.domain, wallet, nonce: i.nonce, issuedAt: record.issuedAt, expiresAt: record.expiresAt });
  if (!verifyEd25519(new TextEncoder().encode(message), sig, key)) return { ok: false, error: "invalid" };
  if (!(await d.nonces.burn(i.nonce, wallet))) return { ok: false, error: "invalid" };

  const jti = randomUUID();
  const expiresAt = now + APP_SESSION_TTL_MS;
  const resume = randomBytes(24).toString("base64url");
  await pgCreateSession(d.db, { jti, wallet, issuedAt: now, expiresAt });
  await tgSetState(d.db, stateKey(jti), { telegramId: i.telegramId, wallet, expiresAt, resumeHash: sha(resume) } satisfies AppSessionState, now);
  return { ok: true, token: makeToken({ jti, telegramId: i.telegramId, wallet, expiresAt }, d.botToken), jti, resume, wallet, expiresAt };
}

export type AppWalletSession = { wallet: string; telegramId: number; jti: string; issuedAt: number };

/**
 * The check behind every request the Mini App makes as a wallet. Null for anything that isn't all of: a token PANDA
 * signed and that hasn't expired, Telegram's own signed data for the SAME account, a session row that is still live,
 * and that account still having this very wallet linked.
 */
export async function appWalletSession(d: Pick<LoginDeps, "db" | "now" | "botToken">, token: unknown, initData: unknown): Promise<AppWalletSession | null> {
  const now = d.now();
  const t = readAppToken(token, d.botToken, now);
  if (!t) return null;
  // Telegram's data is issued once per opening of the app, so by the end of a session it is as old as the session.
  const tg = verifyInitData(initData, d.botToken, now, APP_SESSION_TTL_MS + INIT_DATA_MAX_AGE_MS);
  if (!tg.ok || tg.user.id !== t.telegramId) return null;
  if ((await pgSessionStatus(d.db, t.jti, t.wallet, now)) !== "active") return null;
  if ((await tgGetUser(d.db, t.telegramId))?.wallet !== t.wallet) return null;
  return { wallet: t.wallet, telegramId: t.telegramId, jti: t.jti, issuedAt: t.expiresAt - APP_SESSION_TTL_MS };
}

/** The app was closed (or the user left Telegram): the session ends on the server too. True if it was live. */
export async function closeAppLogin(d: Pick<LoginDeps, "db" | "now" | "botToken">, token: unknown): Promise<boolean> {
  const t = readAppToken(token, d.botToken, d.now());
  if (!t) return false;
  await tgDeleteState(d.db, stateKey(t.jti));
  return pgRevokeSession(d.db, t.jti, "miniapp_closed", d.now());
}

/**
 * Coming back from the wallet app, Telegram sometimes starts the Mini App again from scratch — and what was in its
 * memory is gone. Only for that: the one-time ticket the app wrote down when it opened the wallet brings the SAME
 * session back (same expiry), for the same Telegram account, while the session is still live. The ticket then changes.
 * A session that was closed is revoked, so no ticket can bring it back.
 */
export async function resumeAppLogin(d: Pick<LoginDeps, "db" | "now" | "botToken">, i: { telegramId: number; jti: unknown; resume: unknown }): Promise<AppLogin> {
  const bad = { ok: false, error: "invalid" } as const;
  if (typeof i.jti !== "string" || !/^[0-9a-f-]{36}$/.test(i.jti) || typeof i.resume !== "string" || i.resume.length < 16 || i.resume.length > 64) return bad;
  const now = d.now();
  const state = await tgGetState<AppSessionState>(d.db, stateKey(i.jti));
  if (!state || state.telegramId !== i.telegramId || state.expiresAt <= now) return bad;
  if (!sameBytes(Buffer.from(state.resumeHash, "hex"), Buffer.from(sha(i.resume), "hex"))) return bad;
  if ((await pgSessionStatus(d.db, i.jti, state.wallet, now)) !== "active") return bad;
  if ((await tgGetUser(d.db, i.telegramId))?.wallet !== state.wallet) return { ok: false, error: "not_linked" };
  const resume = randomBytes(24).toString("base64url");
  await tgSetState(d.db, stateKey(i.jti), { ...state, resumeHash: sha(resume) } satisfies AppSessionState, now);
  return { ok: true, token: makeToken({ jti: i.jti, telegramId: i.telegramId, wallet: state.wallet, expiresAt: state.expiresAt }, d.botToken), jti: i.jti, resume, wallet: state.wallet, expiresAt: state.expiresAt };
}
