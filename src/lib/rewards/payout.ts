/**
 * Automatic holder payouts: the pure decisions behind "who gets paid, how much, in what batches" — no network,
 * no database, no signing. The cron (src/app/api/cron/collect-fees/route.ts) supplies real numbers and real
 * addresses; this module only does the arithmetic, so the arithmetic is tested without mocking Solana or Postgres.
 */

/** Is this coin's pending (unclaimed) Holders-pool balance big enough to bother paying out yet? Below the
 *  threshold, the SOL simply stays in the Rewards Pool wallet — still owed, just not worth the gas yet — and
 *  the next cron run (collecting more fees) tries again with a bigger pile. */
export function shouldRunPayout(pendingLamports: number, minLamports: number): boolean {
  return pendingLamports >= minLamports;
}

export type HolderBalance = { wallet: string; unclaimedLamports: number };
export type Payout = { wallet: string; lamports: number };

/**
 * Which holders actually get paid this round, and how much: every excluded address (the bonding curve, the AMM
 * pool, every shareholder of the coin's own fee split — so the creator/PANDA/the pool itself never double-dip
 * as a "holder" — and any program-owned account) is dropped entirely; what's left is capped per wallet at
 * `maxPerWalletLamports` (a single payout still obeys the existing per-claim cap, src/lib/rewards/limits.ts's
 * MAX_CLAIM_LAMPORTS — a very large balance is paid down over several cron runs, never in one risky lump); and
 * anything under `minPerWalletLamports` (a transfer not worth sending — rent-exempt-account-sized dust) is left
 * untouched in the ledger for a future round instead of wasted on a transfer that barely survives itself.
 */
export function computeEligiblePayouts(
  holders: HolderBalance[],
  opts: { exclude: ReadonlySet<string>; minPerWalletLamports: number; maxPerWalletLamports: number }
): Payout[] {
  const out: Payout[] = [];
  for (const h of holders) {
    if (h.unclaimedLamports <= 0) continue;
    if (opts.exclude.has(h.wallet)) continue;
    const amount = Math.min(h.unclaimedLamports, opts.maxPerWalletLamports);
    if (amount < opts.minPerWalletLamports) continue;
    out.push({ wallet: h.wallet, lamports: amount });
  }
  return out;
}

/** Groups payouts into fixed-size batches — one Solana transaction per batch (several SystemProgram.transfer
 *  instructions each), so a widely-held coin's payout round is a handful of transactions instead of one per
 *  holder. Order is preserved; the last batch can be smaller. */
export function batchPayouts<T>(payouts: T[], batchSize: number): T[][] {
  if (batchSize <= 0) return payouts.length ? [payouts] : [];
  const batches: T[][] = [];
  for (let i = 0; i < payouts.length; i += batchSize) batches.push(payouts.slice(i, i + batchSize));
  return batches;
}
