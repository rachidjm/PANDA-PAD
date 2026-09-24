import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { blobConfigured, readJson, updateJson } from "@/lib/rewards/blob-store";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgBurnNonce, pgCreateSession, pgReadNonce, pgRevokeAllForWallet, pgRevokeSession, pgSessionStatus, pgStoreNonce } from "@/lib/db/sessions";
import { consumeNonce, createSessionToken, NonceRecord, readSessionToken, SESSION_TTL_MS } from "./wallet-auth";

/**
 * Server-only. Wallet sessions: an HttpOnly cookie holding an HMAC-signed token with a session id (`jti`).
 *
 * Where the sessions and sign-in nonces live follows PANDA_STORAGE_MODES (`sessions`):
 *   blob      today's behaviour: stateless tokens (valid until they expire, 2 h), one Blob file per nonce. NOT revocable.
 *   dual      tokens carry a jti that is also recorded in Postgres; a token whose session was REVOKED is rejected, tokens from before the
 *             switch (no jti) and a Postgres outage still let people in (this is the migration mode: nothing locks users out).
 *   postgres  a token is valid only while its jti is a live row in Postgres: revoked, expired, unknown or "database down" all mean no session
 *             (fail closed). Nonces are one conditional UPDATE. This is the mode that makes sessions revocable.
 */

export const SESSION_COOKIE = "panda_session";

/** The signing secret, or null when it isn't configured — callers must then refuse (fail closed), never fall back. */
export function sessionSecret(): string | null {
  const s = process.env.AUTH_SESSION_SECRET;
  return s && s.length >= 32 ? s : null;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export type Session = { wallet: string; issuedAt: number; jti?: string };

/** The wallet this request has proven it controls, or null. */
export async function getSessionWallet(req: Request): Promise<string | null> {
  return (await getSession(req))?.wallet ?? null;
}

/** The wallet and the time it last signed in, or null. Checks revocation according to the `sessions` mode (see above). */
export async function getSession(req: Request): Promise<Session | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const parsed = readSessionToken(readCookie(req, SESSION_COOKIE), secret, Date.now());
  if (!parsed) return null;
  const session: Session = { wallet: parsed.wallet, issuedAt: parsed.issuedAt, ...(parsed.jti ? { jti: parsed.jti } : {}) };

  const mode = storageMode("sessions");
  if (mode === "blob") return session;
  if (!parsed.jti) return mode === "dual" ? session : null; // pre-switch tokens live on only while dual
  try {
    const status = await pgSessionStatus(getDb(), parsed.jti, parsed.wallet, Date.now());
    if (status === "active") return session;
    if (status === "unknown" && mode === "dual") return session; // its registration mirror failed: don't lock the user out while migrating
    return null; // revoked, expired, or (postgres mode) unknown
  } catch (err) {
    console.error("[PANDA auth] session lookup failed", err instanceof Error ? err.message : err);
    return mode === "dual" ? session : null; // postgres mode fails CLOSED
  }
}

/** Issues a session: registers it (Postgres modes) and sets the cookie. In postgres mode a failure to register means no session. */
export async function issueSession(res: NextResponse, wallet: string): Promise<{ jti: string }> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Sign-in isn't configured.");
  const now = Date.now();
  const jti = randomUUID();
  const mode = storageMode("sessions");
  const row = { jti, wallet, issuedAt: now, expiresAt: now + SESSION_TTL_MS };
  if (mode === "postgres") await pgCreateSession(getDb(), row);
  else if (mode === "dual") await mirror("sessions", `session ${jti}`, () => pgCreateSession(getDb(), row));
  res.cookies.set(SESSION_COOKIE, createSessionToken(wallet, secret, now, SESSION_TTL_MS, jti), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return { jti };
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
}

/** Whether sessions can be revoked at all on this deployment (they can once `sessions` is dual or postgres). */
export const sessionsRevocable = () => storageMode("sessions") !== "blob";

/** Logout: ends THIS session server-side (not just the cookie). Best effort; returns whether a live session was revoked. */
export async function revokeCurrentSession(req: Request, reason = "logout"): Promise<boolean> {
  if (!sessionsRevocable()) return false;
  const secret = sessionSecret();
  const parsed = secret ? readSessionToken(readCookie(req, SESSION_COOKIE), secret, Date.now()) : null;
  if (!parsed?.jti) return false;
  try {
    return await pgRevokeSession(getDb(), parsed.jti, reason, Date.now());
  } catch (err) {
    console.error("[PANDA auth] logout could not revoke the session", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Ends every live session of a wallet ("close all my sessions", or an admin acting on a suspicious wallet). Returns how many. Throws if Postgres can't be reached. */
export async function revokeAllSessions(wallet: string, reason: string): Promise<number> {
  if (!sessionsRevocable()) throw new Error("Sessions aren't revocable on this deployment yet (PANDA_STORAGE_MODES sessions=dual or postgres).");
  return pgRevokeAllForWallet(getDb(), wallet, reason, Date.now());
}

/** Cross-site requests must not be able to ride a user's session: a present Origin must match this host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; browsers always send Origin on cross-site POSTs
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

const noncePath = (nonce: string) => `auth/nonces/${nonce}.json`;

// Local development without a Blob store only: nonces live in memory. Never in production —
// there a missing store makes sign-in fail closed instead.
const devMemory = new Map<string, NonceRecord>();
const inDevMemoryMode = () => process.env.NODE_ENV !== "production" && !blobConfigured();

/** Stores a fresh challenge. Blob: one file per nonce (unrelated logins never contend); Postgres: one row. */
export async function storeNonce(nonce: string, record: NonceRecord): Promise<void> {
  const mode = storageMode("sessions");
  if (mode === "postgres") {
    if (!(await pgStoreNonce(getDb(), nonce, record))) throw new Error("Nonce collision.");
    return;
  }
  if (inDevMemoryMode()) {
    devMemory.set(nonce, record);
  } else {
    const created = await updateJson<NonceRecord | null, boolean>(noncePath(nonce), null, (cur) => (cur ? { next: cur, result: false } : { next: record, result: true }));
    if (!created) throw new Error("Nonce collision.");
  }
  if (mode === "dual") await mirror("sessions", `nonce ${nonce}`, () => pgStoreNonce(getDb(), nonce, record));
}

/** Atomically burns a nonce. Exactly one of any number of concurrent callers can get `true`. */
export async function burnNonce(nonce: string, wallet: string): Promise<boolean> {
  const mode = storageMode("sessions");
  if (mode === "postgres") return pgBurnNonce(getDb(), nonce, wallet, Date.now());
  let ok: boolean;
  if (inDevMemoryMode()) {
    const r = consumeNonce(devMemory.get(nonce) ?? null, wallet, Date.now());
    if (r.next) devMemory.set(nonce, r.next);
    ok = r.ok;
  } else {
    ok = await updateJson<NonceRecord | null, boolean>(noncePath(nonce), null, (cur) => {
      const r = consumeNonce(cur, wallet, Date.now());
      return { next: r.next, result: r.ok };
    });
  }
  if (ok && mode === "dual") await mirror("sessions", `burn ${nonce}`, () => pgBurnNonce(getDb(), nonce, wallet, Date.now()));
  return ok;
}

/** Nonces are 32 hex chars; anything else never reaches a storage path. */
export const isNonceFormat = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);

export async function readNonce(nonce: string): Promise<NonceRecord | null> {
  if (storageMode("sessions") === "postgres") return pgReadNonce(getDb(), nonce);
  if (inDevMemoryMode()) return devMemory.get(nonce) ?? null;
  return readJson<NonceRecord | null>(noncePath(nonce), null);
}
