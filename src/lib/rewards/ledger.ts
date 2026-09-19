import { readJson, writeJson } from "./blob-store";

export type Ledger = {
  mint: string;
  totalDistributedLamports: number;
  holders: Record<string, { entitledLamports: number; claimedLamports: number }>;
};

function ledgerPath(mint: string): string {
  return `rewards/ledger/${mint}.json`;
}

function emptyLedger(mint: string): Ledger {
  return { mint, totalDistributedLamports: 0, holders: {} };
}

export async function getLedger(mint: string): Promise<Ledger> {
  return readJson<Ledger>(ledgerPath(mint), emptyLedger(mint));
}

/**
 * Real bookkeeping only — called by the collect-fees cron right after it
 * measures a real balance delta on the Rewards Pool wallet for this specific
 * mint (see src/lib/pump/distribute.ts) and enumerates real current holders
 * (src/lib/solana/holders.ts). `credits` must already sum to (approximately)
 * the real delta; this function doesn't invent or adjust amounts, only
 * records them.
 */
export async function creditHolders(mint: string, distributedLamports: number, credits: { address: string; lamports: number }[]): Promise<void> {
  const ledger = await getLedger(mint);
  ledger.totalDistributedLamports += distributedLamports;
  for (const { address, lamports } of credits) {
    if (lamports <= 0) continue;
    const existing = ledger.holders[address] || { entitledLamports: 0, claimedLamports: 0 };
    existing.entitledLamports += lamports;
    ledger.holders[address] = existing;
  }
  await writeJson(ledgerPath(mint), ledger);
}

/** Real unclaimed amount for one holder — entitledLamports minus whatever has already been paid out. */
export function unclaimedLamports(ledger: Ledger, holder: string): number {
  const entry = ledger.holders[holder];
  if (!entry) return 0;
  return Math.max(0, entry.entitledLamports - entry.claimedLamports);
}

/** Called only after a claim transaction is confirmed on-chain — see src/app/api/rewards/claim/route.ts. */
export async function markClaimed(mint: string, holder: string, lamports: number): Promise<void> {
  const ledger = await getLedger(mint);
  const existing = ledger.holders[holder] || { entitledLamports: 0, claimedLamports: 0 };
  existing.claimedLamports += lamports;
  ledger.holders[holder] = existing;
  await writeJson(ledgerPath(mint), ledger);
}
