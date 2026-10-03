import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { legacyFeeWallets, recruiterCodes } from "./schema";

// ── Legacy (grandfathered) wallets ───────────────────────────────────────────────────────────────────────────────

export async function pgIsLegacyFeeWallet(db: Db, wallet: string): Promise<boolean> {
  const [row] = await db.select({ wallet: legacyFeeWallets.wallet }).from(legacyFeeWallets).where(eq(legacyFeeWallets.wallet, wallet));
  return !!row;
}

/** Used only by scripts/backfill-legacy-fee-wallets.ts — the one-time snapshot. Returns false if already marked. */
export async function pgMarkLegacyFeeWallet(db: Db, wallet: string, markedAt: number): Promise<boolean> {
  const rows = await db.insert(legacyFeeWallets).values({ wallet, markedAt }).onConflictDoNothing().returning({ wallet: legacyFeeWallets.wallet });
  return rows.length > 0;
}

export async function pgCountLegacyFeeWallets(db: Db): Promise<number> {
  const rows = await db.select({ wallet: legacyFeeWallets.wallet }).from(legacyFeeWallets);
  return rows.length;
}

// ── Recruiter short codes ────────────────────────────────────────────────────────────────────────────────────────

export async function pgGetWalletByCode(db: Db, code: string): Promise<string | null> {
  const [row] = await db.select({ wallet: recruiterCodes.wallet }).from(recruiterCodes).where(eq(recruiterCodes.code, code));
  return row?.wallet ?? null;
}

export async function pgGetCodeForWallet(db: Db, wallet: string): Promise<string | null> {
  const [row] = await db.select({ code: recruiterCodes.code }).from(recruiterCodes).where(eq(recruiterCodes.wallet, wallet));
  return row?.code ?? null;
}

export type SetCodeOutcome = "set" | "code_taken" | "already_has_code";

/** One code per wallet, chosen once — never overwritten by a later call (see schema.ts: a short link, once
 *  shared, must never break). */
export async function pgSetRecruiterCode(db: Db, wallet: string, code: string, createdAt: number): Promise<SetCodeOutcome> {
  const existing = await pgGetCodeForWallet(db, wallet);
  if (existing) return "already_has_code";
  const rows = await db.insert(recruiterCodes).values({ code, wallet, createdAt }).onConflictDoNothing().returning({ code: recruiterCodes.code });
  return rows.length > 0 ? "set" : "code_taken";
}
