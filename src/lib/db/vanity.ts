import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { vanityMintKeys } from "./schema";

export type VanityRow = { pubkey: string; suffix: string; ciphertext: string; nonce: string };

/** Adds pre-generated keypairs to the stock (already encrypted — see src/lib/vanity/crypto.ts). Skips any
 *  pubkey already in the stock (re-importing the same grind output twice is a no-op). Returns the pubkeys that
 *  were actually new — not necessarily in the same order as `rows`, and not every one of them. */
export async function pgAddVanityKeys(db: Db, rows: VanityRow[]): Promise<string[]> {
  const added: string[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const inserted = await db.insert(vanityMintKeys).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ pubkey: vanityMintKeys.pubkey });
    added.push(...inserted.map((r) => r.pubkey));
  }
  return added;
}

/**
 * Atomically claims ONE unused keypair for `suffix` — `FOR UPDATE SKIP LOCKED` so concurrent launches never
 * receive the same row, and a launch that's mid-claim doesn't make others wait for it. Marks it claimed
 * before returning it (see src/lib/vanity/stock.ts for why: the alternative, marking it used only once the
 * launch confirms, would let two concurrent launches both read it as "unclaimed" first). Null when the stock
 * is empty for this suffix.
 */
export async function pgClaimVanityKey(db: Db, suffix: string): Promise<VanityRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(vanityMintKeys)
      .where(and(eq(vanityMintKeys.suffix, suffix), isNull(vanityMintKeys.claimedAt)))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx.update(vanityMintKeys).set({ claimedAt: Date.now() }).where(eq(vanityMintKeys.pubkey, row.pubkey));
    return { pubkey: row.pubkey, suffix: row.suffix, ciphertext: row.ciphertext, nonce: row.nonce };
  });
}

export async function pgVanityStockCount(db: Db, suffix: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(vanityMintKeys).where(and(eq(vanityMintKeys.suffix, suffix), isNull(vanityMintKeys.claimedAt)));
  return n;
}
