import { randomUUID } from "node:crypto";
import { readJson, updateJson } from "./blob-store";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import {
  pgConfirmClaim,
  pgCreditHolders,
  pgGetLedger,
  pgMarkClaimSent,
  pgReleaseClaim,
  pgReserveClaim,
  pgReserveExact,
} from "@/lib/db/rewards";

/**
 * The holders' rewards ledger. Where it lives depends on PANDA_STORAGE_MODES (src/lib/db/mode.ts): Vercel Blob (`blob`, the
 * original), Blob with every write mirrored into Postgres (`dual`), or Postgres only (`postgres`). Callers don't know which.
 */

export type Ledger = {
  mint: string;
  totalDistributedLamports: number;
  /** Rounding remainder from splits — real lamports the pool holds that no holder was credited. Invariant: sum(entitled) + dust == totalDistributed. */
  dustLamports?: number;
  holders: Record<string, { entitledLamports: number; claimedLamports: number }>;
};

function ledgerPath(mint: string): string {
  return `rewards/ledger/${mint}.json`;
}

function emptyLedger(mint: string): Ledger {
  return { mint, totalDistributedLamports: 0, holders: {} };
}

/** Always a fresh read (never CDN-cached) — stale data here could let a claim be paid twice. */
export async function getLedger(mint: string): Promise<Ledger> {
  if (storageMode("rewards") === "postgres") return pgGetLedger(getDb(), mint);
  return readJson<Ledger>(ledgerPath(mint), emptyLedger(mint));
}

/**
 * Real bookkeeping only — called by the collect-fees cron right after it
 * measures a real balance delta on the Rewards Pool wallet for this specific
 * mint (see src/lib/pump/distribute.ts) and enumerates real current holders
 * (src/lib/solana/holders.ts). `credits` must already sum to (approximately)
 * the real delta; this function doesn't invent or adjust amounts, only
 * records them. Atomic against concurrent claims.
 *
 * `sourceSig` is the signature of the distribution transaction. In Postgres it makes the credit idempotent: the same distribution
 * booked twice (a cron retry) is applied once.
 */
export async function creditHolders(
  mint: string,
  distributedLamports: number,
  credits: { address: string; lamports: number }[],
  dustLamports: number,
  sourceSig: string
): Promise<void> {
  const mode = storageMode("rewards");
  if (mode === "postgres") {
    await pgCreditHolders(getDb(), { mint, sourceSig, distributedLamports, credits, dustLamports });
    return;
  }
  // Fail closed: what is credited plus the dust must account for every distributed lamport, exactly.
  const credited = credits.reduce((sum, c) => sum + c.lamports, 0);
  if (![distributedLamports, dustLamports, credited].every(Number.isSafeInteger) || credits.some((c) => c.lamports < 0) || dustLamports < 0 || credited + dustLamports !== distributedLamports) {
    throw new Error("Refusing to credit: credits + dust don't add up to the distributed amount.");
  }
  await updateJson<Ledger, void>(ledgerPath(mint), emptyLedger(mint), (ledger) => {
    ledger.totalDistributedLamports += distributedLamports;
    ledger.dustLamports = (ledger.dustLamports ?? 0) + dustLamports;
    for (const { address, lamports } of credits) {
      if (lamports <= 0) continue;
      const existing = ledger.holders[address] || { entitledLamports: 0, claimedLamports: 0 };
      existing.entitledLamports += lamports;
      ledger.holders[address] = existing;
    }
    return { next: ledger, result: undefined };
  });
  if (mode === "dual") await mirror("rewards", `credit ${mint}`, () => pgCreditHolders(getDb(), { mint, sourceSig, distributedLamports, credits, dustLamports }));
}

/** Real unclaimed amount for one holder — entitledLamports minus whatever has already been paid out or reserved. */
export function unclaimedLamports(ledger: Ledger, holder: string): number {
  const entry = ledger.holders[holder];
  if (!entry) return 0;
  return Math.max(0, entry.entitledLamports - entry.claimedLamports);
}

/** A booked payout: what was reserved, and (when Postgres has it) the claim row that tracks it. */
export type Reservation = { id: string; mint: string; holder: string; amount: number; pgId?: string };

/**
 * Atomically reserves up to `maxLamports` of a holder's unclaimed balance
 * BEFORE any SOL is sent, so two simultaneous claim requests can never both
 * see the same balance and both get paid. `amount` is what was actually
 * reserved (0 if nothing was claimable). Then: `markClaimSent`, and either
 * `confirmClaim` (it landed) or `releaseClaim` (it definitely did not).
 */
export async function reserveClaim(mint: string, holder: string, maxLamports: number): Promise<Reservation> {
  const mode = storageMode("rewards");
  if (mode === "postgres") {
    const r = await pgReserveClaim(getDb(), mint, holder, maxLamports);
    return { id: r.id, mint, holder, amount: r.amount, pgId: r.amount > 0 ? r.id : undefined };
  }
  const amount = await updateJson<Ledger, number>(ledgerPath(mint), emptyLedger(mint), (ledger) => {
    const entry = ledger.holders[holder];
    const available = entry ? Math.max(0, entry.entitledLamports - entry.claimedLamports) : 0;
    const amount = Math.min(available, maxLamports);
    if (entry && amount > 0) entry.claimedLamports += amount;
    return { next: ledger, result: amount };
  });
  const reservation: Reservation = { id: randomUUID(), mint, holder, amount };
  if (mode === "dual" && amount > 0) {
    await mirror("rewards", `reserve ${mint}/${holder}`, async () => {
      reservation.pgId = (await pgReserveExact(getDb(), mint, holder, amount)).id;
    });
  }
  return reservation;
}

/**
 * The payout transaction was sent. Never throws: SOL has already left the pool, and a bookkeeping hiccup here must not turn a
 * paid claim into an error (the reservation simply stays, which is the safe direction).
 */
export async function markClaimSent(r: Reservation, signature: string): Promise<void> {
  if (!r.pgId) return;
  await mirror("rewards", `sent ${r.id}`, () => pgMarkClaimSent(getDb(), r.pgId as string, signature));
}

/** The payout is confirmed on-chain. Never throws (see markClaimSent). */
export async function confirmClaim(r: Reservation): Promise<void> {
  if (!r.pgId) return;
  await mirror("rewards", `confirm ${r.id}`, () => pgConfirmClaim(getDb(), r.pgId as string));
}

/** Undoes a reservation after a payout that definitely did not land on-chain. */
export async function releaseClaim(r: Reservation): Promise<void> {
  if (r.amount <= 0) return;
  const mode = storageMode("rewards");
  if (mode !== "postgres") {
    await updateJson<Ledger, void>(ledgerPath(r.mint), emptyLedger(r.mint), (ledger) => {
      const entry = ledger.holders[r.holder];
      if (entry) entry.claimedLamports = Math.max(0, entry.claimedLamports - r.amount);
      return { next: ledger, result: undefined };
    });
  }
  if (r.pgId) {
    // In Postgres-only mode this IS the release, so a failure must surface; in dual mode it is a mirror.
    if (mode === "postgres") await pgReleaseClaim(getDb(), r.pgId);
    else await mirror("rewards", `release ${r.id}`, () => pgReleaseClaim(getDb(), r.pgId as string));
  }
}
