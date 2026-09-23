import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { payoutDays, rewardBalances, rewardClaims, rewardCredits, rewardDistributions, rewardLedgers, rewardRegistry } from "./schema";
import type { Ledger } from "@/lib/rewards/ledger";

/**
 * Rewards in Postgres (docs/PHASE6_PLAN.md §1.3). Every function is one transaction; the money invariants are enforced by the
 * database itself (reward_balances CHECK: reserved + claimed <= credited), not only by this code.
 *
 *   distribution (cron)  → creditHolders: applied ONCE per (source signature, mint), all-or-nothing
 *   claim                → reserveClaim (row lock) → markClaimSent → confirmClaim | releaseClaim
 *   daily cap            → reserveDailyPayout: the cap check and the booking are one UPDATE
 */

const isSafeInt = Number.isSafeInteger;

// ── Registry ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function pgRegisterMint(db: Db, mint: string): Promise<void> {
  await db.insert(rewardRegistry).values({ mint }).onConflictDoNothing();
}

export async function pgGetRegisteredMints(db: Db): Promise<string[]> {
  return (await db.select({ mint: rewardRegistry.mint }).from(rewardRegistry).orderBy(rewardRegistry.registeredAt, rewardRegistry.mint)).map((r) => r.mint);
}

// ── Ledger ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Books one distribution: totals, dust and every holder's credit, in one transaction, exactly once per (sourceSig, mint).
 * Same fail-closed rule as the Blob ledger: credits + dust must add up to the distributed amount, to the lamport.
 * Returns "duplicate" (and changes nothing) if this distribution was already applied.
 */
export async function pgCreditHolders(
  db: Db,
  input: { mint: string; sourceSig: string; distributedLamports: number; credits: { address: string; lamports: number }[]; dustLamports: number }
): Promise<"applied" | "duplicate"> {
  const { mint, sourceSig, distributedLamports, dustLamports } = input;
  // Several credits for one wallet are one credit (a multi-row upsert can't touch the same row twice).
  const merged = new Map<string, number>();
  for (const c of input.credits) {
    if (!isSafeInt(c.lamports) || c.lamports < 0) throw new Error("Refusing to credit: credits + dust don't add up to the distributed amount.");
    if (c.lamports > 0) merged.set(c.address, (merged.get(c.address) ?? 0) + c.lamports);
  }
  const credited = [...merged.values()].reduce((a, b) => a + b, 0);
  if (![distributedLamports, dustLamports, credited].every(isSafeInt) || dustLamports < 0 || distributedLamports < 0 || credited + dustLamports !== distributedLamports) {
    throw new Error("Refusing to credit: credits + dust don't add up to the distributed amount.");
  }
  if (!sourceSig) throw new Error("A distribution needs its transaction signature.");

  return db.transaction(async (tx) => {
    const fresh = await tx.insert(rewardDistributions).values({ sourceSig, mint, distributedLamports, dustLamports }).onConflictDoNothing().returning({ sourceSig: rewardDistributions.sourceSig });
    if (fresh.length === 0) return "duplicate";

    await tx
      .insert(rewardLedgers)
      .values({ mint, totalDistributedLamports: distributedLamports, dustLamports })
      .onConflictDoUpdate({
        target: rewardLedgers.mint,
        set: {
          totalDistributedLamports: sql`${rewardLedgers.totalDistributedLamports} + ${distributedLamports}`,
          dustLamports: sql`${rewardLedgers.dustLamports} + ${dustLamports}`,
        },
      });

    const rows = [...merged.entries()];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx.insert(rewardCredits).values(chunk.map(([wallet, lamports]) => ({ mint, wallet, lamports, sourceSig })));
      await tx
        .insert(rewardBalances)
        .values(chunk.map(([wallet, lamports]) => ({ mint, wallet, creditedLamports: lamports })))
        .onConflictDoUpdate({
          target: [rewardBalances.mint, rewardBalances.wallet],
          set: { creditedLamports: sql`${rewardBalances.creditedLamports} + excluded.credited_lamports` },
        });
    }
    return "applied";
  });
}

/** The same shape the Blob ledger had: entitled = credited; claimed = reserved + confirmed (Blob never distinguished them). */
export async function pgGetLedger(db: Db, mint: string): Promise<Ledger> {
  const [row] = await db.select().from(rewardLedgers).where(eq(rewardLedgers.mint, mint));
  const balances = await db.select().from(rewardBalances).where(eq(rewardBalances.mint, mint));
  const ledger: Ledger = { mint, totalDistributedLamports: row?.totalDistributedLamports ?? 0, holders: {} };
  if (row && row.dustLamports > 0) ledger.dustLamports = row.dustLamports;
  for (const b of balances) ledger.holders[b.wallet] = { entitledLamports: b.creditedLamports, claimedLamports: b.reservedLamports + b.claimedLamports };
  return ledger;
}

// ── Claims ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export type PgReservation = { id: string; amount: number };

/**
 * Reserves up to `maxLamports` of the holder's unclaimed balance BEFORE any SOL is sent. The balance row is locked
 * (FOR UPDATE) for the whole transaction, so two simultaneous claims can never both see the same balance; the CHECK on
 * reward_balances is the backstop. `amount` is 0 (and nothing is written) when there is nothing claimable.
 */
export async function pgReserveClaim(db: Db, mint: string, wallet: string, maxLamports: number): Promise<PgReservation> {
  if (!isSafeInt(maxLamports) || maxLamports <= 0) return { id: randomUUID(), amount: 0 };
  return db.transaction(async (tx) => {
    const [bal] = await tx.select().from(rewardBalances).where(and(eq(rewardBalances.mint, mint), eq(rewardBalances.wallet, wallet))).for("update");
    const available = bal ? Math.max(0, bal.creditedLamports - bal.reservedLamports - bal.claimedLamports) : 0;
    const amount = Math.min(available, maxLamports);
    const id = randomUUID();
    if (!bal || amount <= 0) return { id, amount: 0 };
    await tx.update(rewardBalances).set({ reservedLamports: sql`${rewardBalances.reservedLamports} + ${amount}` }).where(and(eq(rewardBalances.mint, mint), eq(rewardBalances.wallet, wallet)));
    await tx.insert(rewardClaims).values({ id, mint, wallet, lamports: amount, status: "reserved" });
    return { id, amount };
  });
}

/**
 * Dual-write mirror of a reservation the Blob ledger already decided: reserves exactly `lamports`, or nothing if Postgres
 * doesn't have that much available (its CHECK would refuse — the mismatch is then visible in db:compare).
 */
export async function pgReserveExact(db: Db, mint: string, wallet: string, lamports: number): Promise<PgReservation> {
  if (!isSafeInt(lamports) || lamports <= 0) return { id: randomUUID(), amount: 0 };
  const r = await pgReserveClaim(db, mint, wallet, lamports);
  if (r.amount !== lamports) {
    // Undo the partial reservation: a mirror must be all-or-nothing so the difference is explicit, not half-applied.
    if (r.amount > 0) await pgReleaseClaim(db, r.id);
    throw new Error(`Postgres has only ${r.amount} of the ${lamports} lamports available for ${wallet} on ${mint}`);
  }
  return r;
}

async function moveClaim(db: Db, id: string, from: string[], to: "sent" | "confirmed" | "released" | "failed", signature?: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [claim] = await tx.select().from(rewardClaims).where(eq(rewardClaims.id, id)).for("update");
    if (!claim || !from.includes(claim.status)) return false;
    await tx.update(rewardClaims).set({ status: to, ...(signature ? { signature } : {}), updatedAt: new Date() }).where(eq(rewardClaims.id, id));
    if (to === "confirmed") {
      await tx.update(rewardBalances).set({ reservedLamports: sql`${rewardBalances.reservedLamports} - ${claim.lamports}`, claimedLamports: sql`${rewardBalances.claimedLamports} + ${claim.lamports}` }).where(and(eq(rewardBalances.mint, claim.mint), eq(rewardBalances.wallet, claim.wallet)));
    } else if (to === "released" || to === "failed") {
      await tx.update(rewardBalances).set({ reservedLamports: sql`${rewardBalances.reservedLamports} - ${claim.lamports}` }).where(and(eq(rewardBalances.mint, claim.mint), eq(rewardBalances.wallet, claim.wallet)));
    }
    return true;
  });
}

/** The payout transaction was sent. The reservation stays until it is confirmed or definitively failed; "sent" with no outcome = review by hand. */
export const pgMarkClaimSent = (db: Db, id: string, signature: string) => moveClaim(db, id, ["reserved"], "sent", signature);
/** The payout is confirmed on-chain: the reserved amount becomes claimed. */
export const pgConfirmClaim = (db: Db, id: string) => moveClaim(db, id, ["reserved", "sent"], "confirmed");
/** The payout definitely did not land: give the reservation back. */
export const pgReleaseClaim = (db: Db, id: string) => moveClaim(db, id, ["reserved", "sent"], "released");

/** Claims that were sent and have no recorded outcome: a payout that may or may not have landed. */
export async function pgOpenClaims(db: Db) {
  return db.select().from(rewardClaims).where(inArray(rewardClaims.status, ["reserved", "sent"]));
}

// ── Daily payout cap ───────────────────────────────────────────────────────────────────────────────────────────────
/** Books `lamports` against `day`'s cap. The cap check and the booking are one atomic UPDATE: false (nothing booked) if it would exceed the cap. */
export async function pgReserveDailyPayout(db: Db, day: string, lamports: number, capLamports: number): Promise<boolean> {
  if (!isSafeInt(lamports) || lamports < 0) return false;
  await db.insert(payoutDays).values({ day }).onConflictDoNothing();
  const booked = await db
    .update(payoutDays)
    .set({ paidLamports: sql`${payoutDays.paidLamports} + ${lamports}` })
    .where(and(eq(payoutDays.day, day), sql`${payoutDays.paidLamports} + ${lamports} <= ${capLamports}`))
    .returning({ day: payoutDays.day });
  return booked.length > 0;
}

/** Dual-write mirror: the Blob side already decided, so this books without a cap check. */
export async function pgAddDailyPayout(db: Db, day: string, lamports: number): Promise<void> {
  await db.insert(payoutDays).values({ day, paidLamports: lamports }).onConflictDoUpdate({ target: payoutDays.day, set: { paidLamports: sql`${payoutDays.paidLamports} + ${lamports}` } });
}

export async function pgReleaseDailyPayout(db: Db, day: string, lamports: number): Promise<void> {
  if (lamports <= 0) return;
  await db.update(payoutDays).set({ paidLamports: sql`greatest(0, ${payoutDays.paidLamports} - ${lamports})` }).where(eq(payoutDays.day, day));
}

export async function pgGetPayoutDay(db: Db, day: string): Promise<number> {
  const [row] = await db.select().from(payoutDays).where(eq(payoutDays.day, day));
  return row?.paidLamports ?? 0;
}
