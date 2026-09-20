import { readJson, updateJson } from "./blob-store";

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
  return readJson<Ledger>(ledgerPath(mint), emptyLedger(mint));
}

/**
 * Real bookkeeping only — called by the collect-fees cron right after it
 * measures a real balance delta on the Rewards Pool wallet for this specific
 * mint (see src/lib/pump/distribute.ts) and enumerates real current holders
 * (src/lib/solana/holders.ts). `credits` must already sum to (approximately)
 * the real delta; this function doesn't invent or adjust amounts, only
 * records them. Atomic against concurrent claims.
 */
export async function creditHolders(
  mint: string,
  distributedLamports: number,
  credits: { address: string; lamports: number }[],
  dustLamports: number
): Promise<void> {
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
}

/** Real unclaimed amount for one holder — entitledLamports minus whatever has already been paid out or reserved. */
export function unclaimedLamports(ledger: Ledger, holder: string): number {
  const entry = ledger.holders[holder];
  if (!entry) return 0;
  return Math.max(0, entry.entitledLamports - entry.claimedLamports);
}

/**
 * Atomically reserves up to `maxLamports` of a holder's unclaimed balance
 * BEFORE any SOL is sent, so two simultaneous claim requests can never both
 * see the same balance and both get paid. Returns the amount actually
 * reserved (0 if nothing was claimable). If the payout then definitively
 * fails, call `releaseClaim`.
 */
export async function reserveClaim(mint: string, holder: string, maxLamports: number): Promise<number> {
  return updateJson<Ledger, number>(ledgerPath(mint), emptyLedger(mint), (ledger) => {
    const entry = ledger.holders[holder];
    const available = entry ? Math.max(0, entry.entitledLamports - entry.claimedLamports) : 0;
    const amount = Math.min(available, maxLamports);
    if (entry && amount > 0) entry.claimedLamports += amount;
    return { next: ledger, result: amount };
  });
}

/** Undoes a reservation after a payout that definitely did not land on-chain. */
export async function releaseClaim(mint: string, holder: string, lamports: number): Promise<void> {
  if (lamports <= 0) return;
  await updateJson<Ledger, void>(ledgerPath(mint), emptyLedger(mint), (ledger) => {
    const entry = ledger.holders[holder];
    if (entry) entry.claimedLamports = Math.max(0, entry.claimedLamports - lamports);
    return { next: ledger, result: undefined };
  });
}
