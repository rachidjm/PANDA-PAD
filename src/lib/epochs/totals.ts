import { createHash } from "node:crypto";
import { walletTotal, WalletEpochDoc } from "@/lib/points/events";

/**
 * The finalized result of an epoch: one row per wallet with its points. Rows
 * are sorted by wallet and serialized canonically, so the same inputs always
 * produce byte-identical output and the same hash — that hash is what pins
 * the epoch's results (and what a Merkle airdrop will later be built from).
 */

export type EpochTotals = {
  epoch: number;
  formulaVersion: string;
  entries: { wallet: string; points: number }[];
  /**
   * Wallets whose points were held OUT of this epoch by the anti-abuse system (RESTRICTED / DISQUALIFIED at
   * finalization), with what they would have had. Present only when non-empty, so epochs finalized without
   * any exclusion keep the exact hash they always had. The withheld points stay in the ledger.
   */
  excluded?: { wallet: string; points: number }[];
  totalPoints: number;
  hash: string;
};

export function canonicalTotalsBody(
  epoch: number,
  formulaVersion: string,
  entries: { wallet: string; points: number }[],
  excluded: { wallet: string; points: number }[] = []
): string {
  const base = { epoch, formulaVersion, entries: entries.map((e) => [e.wallet, e.points]) };
  return JSON.stringify(excluded.length > 0 ? { ...base, excluded: excluded.map((e) => [e.wallet, e.points]) } : base);
}

export const hashTotals = (body: string) => createHash("sha256").update(body).digest("hex");

export function buildTotals(epoch: number, formulaVersion: string, docs: WalletEpochDoc[], excludedWallets: readonly string[] = []): EpochTotals {
  const held = new Set(excludedWallets);
  const byWallet = new Map<string, number>();
  for (const doc of docs) {
    if (doc.epoch !== epoch) throw new Error(`Document for epoch ${doc.epoch} found while totalling epoch ${epoch}.`);
    byWallet.set(doc.wallet, (byWallet.get(doc.wallet) ?? 0) + walletTotal(doc));
  }
  const bySort = ([a]: [string, number], [b]: [string, number]) => (a < b ? -1 : a > b ? 1 : 0);
  const positive = [...byWallet.entries()].filter(([, points]) => points > 0).sort(bySort);
  const entries = positive.filter(([wallet]) => !held.has(wallet)).map(([wallet, points]) => ({ wallet, points }));
  const excluded = positive.filter(([wallet]) => held.has(wallet)).map(([wallet, points]) => ({ wallet, points }));

  const totalPoints = entries.reduce((sum, e) => sum + e.points, 0);
  if (!Number.isSafeInteger(totalPoints)) throw new Error("Total points overflowed a safe integer.");
  return {
    epoch,
    formulaVersion,
    entries,
    ...(excluded.length > 0 ? { excluded } : {}),
    totalPoints,
    hash: hashTotals(canonicalTotalsBody(epoch, formulaVersion, entries, excluded)),
  };
}

/** True only if the stored totals still hash to what they claim (tamper / corruption check). */
export function totalsAreIntact(t: EpochTotals): boolean {
  const sum = t.entries.reduce((s, e) => s + e.points, 0);
  return sum === t.totalPoints && hashTotals(canonicalTotalsBody(t.epoch, t.formulaVersion, t.entries, t.excluded ?? [])) === t.hash;
}
