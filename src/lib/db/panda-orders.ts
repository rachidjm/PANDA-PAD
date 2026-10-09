import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "./client";
import { pandaNonceAccounts, pandaOrders } from "./schema";
import { LIVE_STATES, PREPARED_TTL_MS, TERMINAL_STATES, type OrderState } from "@/lib/panda-orders/math";

/**
 * Postgres repository for PANDA orders. Every state change says which states it expects to find (`from`), so a
 * watcher run and a user's cancel racing each other can't both win, and a final state is never left.
 */

export type PandaOrderRow = typeof pandaOrders.$inferSelect;
export type PandaOrderInsert = typeof pandaOrders.$inferInsert;
export type NonceRow = typeof pandaNonceAccounts.$inferSelect;

/** A prepared (unsigned) order nobody signed in time stops holding its nonce account. */
export async function pgPurgeExpiredPrepared(db: Db, now: number): Promise<void> {
  await db.delete(pandaOrders).where(and(eq(pandaOrders.state, "prepared"), lt(pandaOrders.createdAt, now - PREPARED_TTL_MS)));
}

export async function pgListOrders(db: Db, wallet: string, mint?: string, limit = 200): Promise<PandaOrderRow[]> {
  const where = mint ? and(eq(pandaOrders.wallet, wallet), eq(pandaOrders.mint, mint)) : eq(pandaOrders.wallet, wallet);
  return db.select().from(pandaOrders).where(where).orderBy(desc(pandaOrders.createdAt)).limit(limit);
}

export async function pgLiveOrders(db: Db, wallet: string, mint?: string): Promise<PandaOrderRow[]> {
  const live = inArray(pandaOrders.state, [...LIVE_STATES]);
  const where = mint ? and(eq(pandaOrders.wallet, wallet), eq(pandaOrders.mint, mint), live) : and(eq(pandaOrders.wallet, wallet), live);
  return db.select().from(pandaOrders).where(where);
}

export async function pgNonceAccounts(db: Db, wallet: string): Promise<NonceRow[]> {
  return db.select().from(pandaNonceAccounts).where(eq(pandaNonceAccounts.wallet, wallet));
}

export async function pgUpsertNonce(db: Db, row: { address: string; wallet: string; seed: string; state: "pending" | "ready" | "closed" }, now: number): Promise<void> {
  await db
    .insert(pandaNonceAccounts)
    .values({ ...row, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: pandaNonceAccounts.address, set: { state: row.state, updatedAt: now }, where: eq(pandaNonceAccounts.wallet, row.wallet) });
}

export async function pgSetNonceState(db: Db, wallet: string, address: string, state: "pending" | "ready" | "closed", now: number): Promise<void> {
  await db.update(pandaNonceAccounts).set({ state, updatedAt: now }).where(and(eq(pandaNonceAccounts.address, address), eq(pandaNonceAccounts.wallet, wallet)));
}

/** Replaces this group's prepared (unsigned) orders with `rows`, atomically. A live (signed) order is never touched. */
export async function pgReplacePrepared(db: Db, wallet: string, groupId: string, rows: PandaOrderInsert[], now: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(pandaOrders).where(and(eq(pandaOrders.state, "prepared"), lt(pandaOrders.createdAt, now - PREPARED_TTL_MS)));
    await tx.delete(pandaOrders).where(and(eq(pandaOrders.wallet, wallet), eq(pandaOrders.groupId, groupId), eq(pandaOrders.state, "prepared")));
    if (rows.length) await tx.insert(pandaOrders).values(rows);
  });
}

export async function pgGetPrepared(db: Db, wallet: string, ids: string[], now: number): Promise<PandaOrderRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(pandaOrders).where(and(eq(pandaOrders.wallet, wallet), inArray(pandaOrders.id, ids), eq(pandaOrders.state, "prepared")));
  return rows.filter((r) => now - r.createdAt <= PREPARED_TTL_MS);
}

/** prepared → active for EVERY item, or for none (one failed check rolls the whole batch back). */
export async function pgActivate(db: Db, wallet: string, items: { id: string; txCiphertext: string; txIv: string; signature: string }[], now: number): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      for (const it of items) {
        const updated = await tx
          .update(pandaOrders)
          .set({ state: "active", txCiphertext: it.txCiphertext, txIv: it.txIv, signature: it.signature, updatedAt: now })
          .where(and(eq(pandaOrders.id, it.id), eq(pandaOrders.wallet, wallet), eq(pandaOrders.state, "prepared"), sql`${pandaOrders.createdAt} >= ${now - PREPARED_TTL_MS}`))
          .returning({ id: pandaOrders.id });
        if (updated.length !== 1) throw new Error("not_prepared");
      }
    });
    return true;
  } catch {
    return false;
  }
}

/** Every order the watcher has to look at (any wallet). */
export async function pgWatchList(db: Db, limit = 1000): Promise<PandaOrderRow[]> {
  return db.select().from(pandaOrders).where(inArray(pandaOrders.state, ["active", "sending"])).orderBy(pandaOrders.createdAt).limit(limit);
}

export type OrderPatch = Partial<Pick<PandaOrderRow, "state" | "reason" | "notice" | "noticeAt" | "lastCheckedAt" | "unknownFailures" | "sentAt" | "executedAt">>;

/** Applies `patch` only if the order is in one of `from`. A final state also wipes the stored signed bytes. Returns the row or null. */
export async function pgTransition(db: Db, id: string, from: readonly OrderState[], patch: OrderPatch, now: number): Promise<PandaOrderRow | null> {
  const final = patch.state !== undefined && TERMINAL_STATES.includes(patch.state as OrderState);
  const [row] = await db
    .update(pandaOrders)
    .set({ ...patch, ...(final ? { txCiphertext: null, txIv: null } : {}), updatedAt: now })
    .where(and(eq(pandaOrders.id, id), inArray(pandaOrders.state, [...from])))
    .returning();
  return row ?? null;
}

/** Every live order of this wallet on these nonce accounts. */
export async function pgLiveByNonces(db: Db, wallet: string, nonces: string[]): Promise<PandaOrderRow[]> {
  if (nonces.length === 0) return [];
  return db.select().from(pandaOrders).where(and(eq(pandaOrders.wallet, wallet), inArray(pandaOrders.nonceAccount, nonces), inArray(pandaOrders.state, [...LIVE_STATES])));
}
