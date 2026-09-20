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
  totalPoints: number;
  hash: string;
};

export function canonicalTotalsBody(epoch: number, formulaVersion: string, entries: { wallet: string; points: number }[]): string {
  return JSON.stringify({ epoch, formulaVersion, entries: entries.map((e) => [e.wallet, e.points]) });
}

export const hashTotals = (body: string) => createHash("sha256").update(body).digest("hex");

export function buildTotals(epoch: number, formulaVersion: string, docs: WalletEpochDoc[]): EpochTotals {
  const byWallet = new Map<string, number>();
  for (const doc of docs) {
    if (doc.epoch !== epoch) throw new Error(`Document for epoch ${doc.epoch} found while totalling epoch ${epoch}.`);
    byWallet.set(doc.wallet, (byWallet.get(doc.wallet) ?? 0) + walletTotal(doc));
  }
  const entries = [...byWallet.entries()]
    .filter(([, points]) => points > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([wallet, points]) => ({ wallet, points }));

  const totalPoints = entries.reduce((sum, e) => sum + e.points, 0);
  if (!Number.isSafeInteger(totalPoints)) throw new Error("Total points overflowed a safe integer.");
  return { epoch, formulaVersion, entries, totalPoints, hash: hashTotals(canonicalTotalsBody(epoch, formulaVersion, entries)) };
}

/** True only if the stored totals still hash to what they claim (tamper / corruption check). */
export function totalsAreIntact(t: EpochTotals): boolean {
  const sum = t.entries.reduce((s, e) => s + e.points, 0);
  return sum === t.totalPoints && hashTotals(canonicalTotalsBody(t.epoch, t.formulaVersion, t.entries)) === t.hash;
}
