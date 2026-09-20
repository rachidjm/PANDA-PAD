import { NextResponse } from "next/server";
import { blobConfigured, readJson, updateJson } from "@/lib/rewards/blob-store";
import { consumeNonce, createSessionToken, NonceRecord, readSessionToken, SESSION_TTL_MS } from "./wallet-auth";

/** Server-only. Wallet sessions: an HttpOnly cookie holding an HMAC-signed, short-lived token. */

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

/** The wallet this request has proven it controls, or null. */
export function getSessionWallet(req: Request): string | null {
  return getSession(req)?.wallet ?? null;
}

/** The wallet and the time it last signed in, or null. */
export function getSession(req: Request): { wallet: string; issuedAt: number } | null {
  const secret = sessionSecret();
  if (!secret) return null;
  return readSessionToken(readCookie(req, SESSION_COOKIE), secret, Date.now());
}

export function setSessionCookie(res: NextResponse, wallet: string): void {
  const secret = sessionSecret();
  if (!secret) throw new Error("Sign-in isn't configured.");
  res.cookies.set(SESSION_COOKIE, createSessionToken(wallet, secret, Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
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

/** Stores a fresh challenge. One blob per nonce, so unrelated logins never contend for a lock. */
export async function storeNonce(nonce: string, record: NonceRecord): Promise<void> {
  if (inDevMemoryMode()) {
    devMemory.set(nonce, record);
    return;
  }
  const created = await updateJson<NonceRecord | null, boolean>(noncePath(nonce), null, (cur) =>
    cur ? { next: cur, result: false } : { next: record, result: true }
  );
  if (!created) throw new Error("Nonce collision.");
}

/** Atomically burns a nonce. Exactly one of any number of concurrent callers can get `true`. */
export async function burnNonce(nonce: string, wallet: string): Promise<boolean> {
  if (inDevMemoryMode()) {
    const { next, ok } = consumeNonce(devMemory.get(nonce) ?? null, wallet, Date.now());
    if (next) devMemory.set(nonce, next);
    return ok;
  }
  return updateJson<NonceRecord | null, boolean>(noncePath(nonce), null, (cur) => {
    const { next, ok } = consumeNonce(cur, wallet, Date.now());
    return { next, result: ok };
  });
}

/** Nonces are 32 hex chars; anything else never reaches a storage path. */
export const isNonceFormat = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);

export async function readNonce(nonce: string): Promise<NonceRecord | null> {
  if (inDevMemoryMode()) return devMemory.get(nonce) ?? null;
  return readJson<NonceRecord | null>(noncePath(nonce), null);
}
