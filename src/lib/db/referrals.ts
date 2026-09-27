import { count, eq, sum } from "drizzle-orm";
import type { Db } from "./client";
import { referralPayouts, referrals } from "./schema";

/** This wallet's referrer, or null if it was never bound (came in without a link, campaign was closed, failed anti-abuse, ...). */
export async function pgGetReferrer(db: Db, wallet: string): Promise<string | null> {
  const [row] = await db.select({ referrer: referrals.referrer }).from(referrals).where(eq(referrals.wallet, wallet));
  return row?.referrer ?? null;
}

/**
 * First-touch, permanent: binds `wallet` to `referrer` UNLESS it's already bound to someone (itself included) —
 * a primary-key conflict, so of two concurrent sign-ins only one ever wins. Returns whether THIS call bound it.
 * Callers must reject `wallet === referrer` themselves before calling (the CHECK constraint is the last line of
 * defense, not the primary one — it turns a bug here into a loud failure instead of a silent bad row).
 */
export async function pgBindReferral(db: Db, wallet: string, referrer: string, boundAt: number): Promise<boolean> {
  const rows = await db.insert(referrals).values({ wallet, referrer, boundAt }).onConflictDoNothing().returning({ wallet: referrals.wallet });
  return rows.length > 0;
}

/** Records one verified on-chain referral payment (informational — see schema.ts). Returns false if it was already recorded. */
export async function pgRecordReferralPayout(
  db: Db,
  row: { signature: string; referrer: string; referred: string; mint: string; lamports: number; ts: number }
): Promise<boolean> {
  const rows = await db.insert(referralPayouts).values(row).onConflictDoNothing().returning({ signature: referralPayouts.signature });
  return rows.length > 0;
}

export type ReferralStats = { referredCount: number; earnedLamports: number };

/** How many wallets `referrer` has brought in, and how much PANDA has verified was actually paid to them on-chain. */
export async function pgReferralStats(db: Db, referrer: string): Promise<ReferralStats> {
  const [[{ n }], [{ total }]] = await Promise.all([
    db.select({ n: count() }).from(referrals).where(eq(referrals.referrer, referrer)),
    db.select({ total: sum(referralPayouts.lamports) }).from(referralPayouts).where(eq(referralPayouts.referrer, referrer)),
  ]);
  return { referredCount: n, earnedLamports: Number(total ?? 0) };
}
