import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { reservedMintKeys } from "./schema";

export type ReservedMintRow = { purpose: string; pubkey: string; ciphertext: string; nonce: string; usedAt: number | null };

/** One-time import — fails (returns false) if this `purpose` already has a row, so a reserved key is never
 *  silently replaced by a second import. */
export async function pgSetReservedMintKey(db: Db, row: { purpose: string; pubkey: string; ciphertext: string; nonce: string }): Promise<boolean> {
  const rows = await db.insert(reservedMintKeys).values(row).onConflictDoNothing().returning({ purpose: reservedMintKeys.purpose });
  return rows.length > 0;
}

/** Read-only — never marks the row used. For status checks and simulations only. */
export async function pgGetReservedMintKey(db: Db, purpose: string): Promise<ReservedMintRow | null> {
  const [row] = await db.select().from(reservedMintKeys).where(eq(reservedMintKeys.purpose, purpose));
  return row ?? null;
}

/**
 * Atomically claims the reserved key for `purpose` — `FOR UPDATE SKIP LOCKED` so two concurrent requests can
 * never both receive it, and marks it used in the same transaction before returning it (same reasoning as
 * pgClaimVanityKey: the alternative, marking it used only once a launch confirms, would let two concurrent
 * attempts both read it as "unused" first). Null when it doesn't exist or has already been used — there is no
 * second one to fall back to.
 */
export async function pgClaimReservedMintKey(db: Db, purpose: string): Promise<ReservedMintRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(reservedMintKeys)
      .where(and(eq(reservedMintKeys.purpose, purpose), isNull(reservedMintKeys.usedAt)))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx.update(reservedMintKeys).set({ usedAt: Date.now() }).where(eq(reservedMintKeys.purpose, purpose));
    return { purpose: row.purpose, pubkey: row.pubkey, ciphertext: row.ciphertext, nonce: row.nonce, usedAt: Date.now() };
  });
}
