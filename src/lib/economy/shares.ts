/**
 * How a confirmed `distributeCreatorFees` transaction split the creator fees, read from the transaction's own
 * balance changes (not estimated from the configured percentages). Pure.
 */

export type BalanceView = { keys: string[]; pre: number[]; post: number[]; fee: number; feePayer: string };
export type Share = { address: string; lamports: number };

/**
 * Each shareholder's real payout: its balance change in the transaction, plus the network fee if it paid it
 * (the Rewards Pool signs and pays, so its raw change is its share minus the fee). Never negative.
 */
export function distributionShares(view: BalanceView, shareholders: string[]): Share[] {
  return [...new Set(shareholders)].map((address) => {
    const i = view.keys.indexOf(address);
    if (i === -1) return { address, lamports: 0 };
    const delta = (view.post[i] ?? 0) - (view.pre[i] ?? 0) + (address === view.feePayer ? view.fee : 0);
    return { address, lamports: Math.max(0, delta) };
  });
}

export type FeeBreakdown = { total: number; treasury: number; pool: number; others: number };

export function breakdown(shares: Share[], treasury: string, pool: string): FeeBreakdown {
  const total = shares.reduce((s, x) => s + x.lamports, 0);
  const of = (a: string) => shares.find((s) => s.address === a)?.lamports ?? 0;
  const t = of(treasury);
  const p = pool === treasury ? 0 : of(pool);
  return { total, treasury: t, pool: p, others: total - t - p };
}
