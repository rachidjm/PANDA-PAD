import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

/**
 * Wallet-ownership authentication primitives — pure functions (no I/O, time
 * and secrets passed in) so every rule is unit-testable.
 *
 * Flow: the server issues a one-time challenge (nonce + short expiry, bound to
 * the site's domain and the wallet) → the wallet signs it → the server
 * verifies the ed25519 signature over a message IT rebuilds from its own
 * stored record (the client can't alter what was signed), burns the nonce, and
 * hands back a short-lived HMAC-signed session. A signature is therefore
 * useless a second time, on another domain, for another wallet, or after it
 * expires.
 */

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 2 * 60 * 60_000;

export type NonceRecord = { wallet: string; issuedAt: number; expiresAt: number; used: boolean };

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export function buildSignInMessage(p: {
  domain: string;
  wallet: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  return [
    "PANDA wants you to sign in with your Solana wallet.",
    "",
    `Domain: ${p.domain}`,
    `Wallet: ${p.wallet}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${new Date(p.issuedAt).toISOString()}`,
    `Expires At: ${new Date(p.expiresAt).toISOString()}`,
    "",
    "Signing is free and does not move any funds. Only sign this on the PANDA site you are using.",
  ].join("\n");
}

// Fixed prefix of an ed25519 public key in SPKI/DER form; the 32 key bytes follow.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** True only if `signature` is a valid ed25519 signature of `message` by the 32-byte `publicKey`. Never throws. */
export function verifyEd25519(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, publicKey]), format: "der", type: "spki" });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/**
 * Decides whether a stored nonce may be consumed right now, and returns the
 * record to persist. Used inside an atomic (ETag-guarded) update so that of
 * two simultaneous verifications of one nonce exactly one gets `ok: true`.
 */
export function consumeNonce(
  record: NonceRecord | null,
  wallet: string,
  now: number
): { next: NonceRecord | null; ok: boolean } {
  if (!record) return { next: record, ok: false };
  if (record.used || record.wallet !== wallet || now > record.expiresAt) return { next: record, ok: false };
  return { next: { ...record, used: true }, ok: true };
}

// ---- session token: base64url(payload).base64url(HMAC-SHA256) -------------

/** `j` is the session id (jti): what lets a session be revoked before it expires. Tokens issued before it existed have none. */
type SessionPayload = { w: string; iat: number; exp: number; j?: string };

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(`panda-session-v1.${body}`).digest();
}

export function requireSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) throw new Error("AUTH_SESSION_SECRET must be set to at least 32 characters.");
}

export function createSessionToken(wallet: string, secret: string, now: number, ttlMs = SESSION_TTL_MS, jti?: string): string {
  requireSecret(secret);
  const payload: SessionPayload = { w: wallet, iat: now, exp: now + ttlMs, ...(jti ? { j: jti } : {}) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(secret, body).toString("base64url")}`;
}

/** Returns the wallet the token was issued to, or null for anything malformed, forged, or expired. */
export function verifySessionToken(token: string | undefined | null, secret: string, now: number): string | null {
  return readSessionToken(token, secret, now)?.wallet ?? null;
}

/** Like verifySessionToken, but also returns when the wallet last signed in (`issuedAt`, ms). */
export function readSessionToken(
  token: string | undefined | null,
  secret: string,
  now: number
): { wallet: string; issuedAt: number; expiresAt: number; jti?: string } | null {
  try {
    requireSecret(secret);
    if (!token) return null;
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra !== undefined) return null;
    const expected = mac(secret, body);
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.w !== "string" || !Number.isFinite(payload.exp) || now >= payload.exp) return null;
    return { wallet: payload.w, issuedAt: payload.iat, expiresAt: payload.exp, ...(typeof payload.j === "string" && /^[0-9a-f-]{36}$/.test(payload.j) ? { jti: payload.j } : {}) };
  } catch {
    return null;
  }
}
