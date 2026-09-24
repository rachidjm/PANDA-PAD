import { eq, inArray, isNull, and, sql } from "drizzle-orm";
import type { Db } from "./client";
import { pendingFeeLocks } from "./schema";
import type { PendingFeeLock } from "@/lib/pump/fee-lock";

/** The fee-lock registry (coins created without their fee split yet) in Postgres. */

const toEntry = (r: typeof pendingFeeLocks.$inferSelect): PendingFeeLock => ({
  creator: r.creator,
  ts: r.ts,
  shareholders: (r.shareholders as PendingFeeLock["shareholders"]) ?? null,
  ...(r.auditedAt !== null ? { auditedAt: r.auditedAt } : {}),
});

export async function pgLoadPending(db: Db): Promise<Record<string, PendingFeeLock>> {
  const rows = await db.select().from(pendingFeeLocks);
  return Object.fromEntries(rows.map((r) => [r.mint, toEntry(r)]));
}

/** Registers (or refreshes) a mint. False — and nothing written — when the registry is at `hardCap` and this mint is new. */
export async function pgRegisterPending(db: Db, mint: string, e: { creator: string; ts: number; shareholders: PendingFeeLock["shareholders"] }, hardCap: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('panda_fee_lock'))`);
    const [existing] = await tx.select({ m: pendingFeeLocks.mint }).from(pendingFeeLocks).where(eq(pendingFeeLocks.mint, mint));
    if (!existing) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(pendingFeeLocks);
      if (Number(n) >= hardCap) return false;
    }
    await tx
      .insert(pendingFeeLocks)
      .values({ mint, creator: e.creator, ts: e.ts, shareholders: e.shareholders })
      .onConflictDoUpdate({ target: pendingFeeLocks.mint, set: { creator: e.creator, ts: e.ts, shareholders: e.shareholders, auditedAt: null } });
    return true;
  });
}

export async function pgRemovePending(db: Db, mints: string[]): Promise<void> {
  if (mints.length === 0) return;
  await db.delete(pendingFeeLocks).where(inArray(pendingFeeLocks.mint, mints));
}

/** Stamps the "created without its split" audit time ONCE. True only for the caller that stamped it. */
export async function pgStampAudited(db: Db, mint: string, at: number): Promise<boolean> {
  const r = await db.update(pendingFeeLocks).set({ auditedAt: at }).where(and(eq(pendingFeeLocks.mint, mint), isNull(pendingFeeLocks.auditedAt))).returning({ m: pendingFeeLocks.mint });
  return r.length > 0;
}
