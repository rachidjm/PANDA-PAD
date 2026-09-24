import { and, eq, isNull, lt, gt, sql } from "drizzle-orm";
import type { Db } from "./client";
import { authNonces, sessions } from "./schema";
import type { NonceRecord } from "@/lib/auth/wallet-auth";

/** Sessions and sign-in nonces in Postgres (phase 6, point 4). Every function is one statement or one transaction. */

// ── sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function pgCreateSession(db: Db, s: { jti: string; wallet: string; issuedAt: number; expiresAt: number }): Promise<void> {
  await db.insert(sessions).values(s);
}

export type SessionStatus = "active" | "revoked" | "expired" | "unknown";

export async function pgSessionStatus(db: Db, jti: string, wallet: string, now: number): Promise<SessionStatus> {
  const [row] = await db.select().from(sessions).where(eq(sessions.jti, jti));
  if (!row || row.wallet !== wallet) return "unknown";
  if (row.revokedAt !== null) return "revoked";
  return row.expiresAt > now ? "active" : "expired";
}

/** True only if this session exists for this wallet, isn't revoked and hasn't expired. */
export async function pgSessionActive(db: Db, jti: string, wallet: string, now: number): Promise<boolean> {
  return (await pgSessionStatus(db, jti, wallet, now)) === "active";
}

/** Revokes one session. False if it was unknown or already revoked. */
export async function pgRevokeSession(db: Db, jti: string, reason: string, now: number): Promise<boolean> {
  const r = await db.update(sessions).set({ revokedAt: now, revokedReason: reason.slice(0, 200) }).where(and(eq(sessions.jti, jti), isNull(sessions.revokedAt))).returning({ jti: sessions.jti });
  return r.length > 0;
}

/** Revokes every live session of a wallet ("close all my sessions", or an admin acting on a suspicious wallet). Returns how many. */
export async function pgRevokeAllForWallet(db: Db, wallet: string, reason: string, now: number): Promise<number> {
  const r = await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 200) })
    .where(and(eq(sessions.wallet, wallet), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .returning({ jti: sessions.jti });
  return r.length;
}

export async function pgCountLiveSessions(db: Db, wallet: string, now: number): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.wallet, wallet), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  return Number(n);
}

// ── nonces ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** False if that nonce already exists (a collision: the caller starts over). */
export async function pgStoreNonce(db: Db, nonce: string, r: NonceRecord): Promise<boolean> {
  const rows = await db.insert(authNonces).values({ nonce, wallet: r.wallet, issuedAt: r.issuedAt, expiresAt: r.expiresAt }).onConflictDoNothing().returning({ nonce: authNonces.nonce });
  return rows.length > 0;
}

export async function pgReadNonce(db: Db, nonce: string): Promise<NonceRecord | null> {
  const [row] = await db.select().from(authNonces).where(eq(authNonces.nonce, nonce));
  return row ? { wallet: row.wallet, issuedAt: row.issuedAt, expiresAt: row.expiresAt, used: row.usedAt !== null } : null;
}

/**
 * Burns a nonce: ONE conditional UPDATE (unused, this wallet's, not expired). Of any number of concurrent callers exactly one gets true.
 */
export async function pgBurnNonce(db: Db, nonce: string, wallet: string, now: number): Promise<boolean> {
  const rows = await db
    .update(authNonces)
    .set({ usedAt: now })
    .where(and(eq(authNonces.nonce, nonce), eq(authNonces.wallet, wallet), isNull(authNonces.usedAt), gt(authNonces.expiresAt, now - 1)))
    .returning({ nonce: authNonces.nonce });
  return rows.length > 0;
}

/** Daily cleanup: expired nonces (a day after they expired) and sessions that expired more than a week ago. Live ones are never touched. */
export async function pgCleanupAuth(db: Db, now: number): Promise<{ nonces: number; sessions: number }> {
  const n = await db.delete(authNonces).where(lt(authNonces.expiresAt, now - 24 * 3_600_000)).returning({ nonce: authNonces.nonce });
  const s = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now - 7 * 24 * 3_600_000))
    .returning({ jti: sessions.jti });
  return { nonces: n.length, sessions: s.length };
}
