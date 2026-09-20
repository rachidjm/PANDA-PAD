import type { PortfolioHolding } from "@/lib/types";
import type { Position } from "./positions";

/**
 * Turns what the wallet REALLY holds (read from Solana) plus what PANDA knows about its trades into the
 * rows and totals the Portfolio page shows — and is strict about what it may claim:
 *
 *  - "tracked":     P&L from trades PANDA recorded itself, covering the whole balance you hold now;
 *  - "estimated":   the trade history is partial, was read back from the chain (approximate), or doesn't
 *                   match the balance — the number is a best guess and is labelled as one;
 *  - "unavailable": no known purchase price or no live price. No number is shown, never a fake zero.
 *
 * Pure functions, no network: everything they need is passed in.
 */

export const NATIVE_MINT = "So11111111111111111111111111111111111111112";
/** A balance within this share of the logged position counts as "the same holding". */
export const COVERAGE_TOLERANCE = 0.98;

export type Pnl =
  | { kind: "tracked" | "estimated"; usd: number; pct: number }
  | { kind: "unavailable"; reason: "no_trades" | "no_price" | "not_tracked" };

export type TokenRow = {
  mint: string;
  symbol?: string;
  name?: string;
  image?: string;
  amount: number;
  priceUsd?: number;
  valueUsd?: number;
  changePct?: number;
  /** Average purchase price per token in USD, when known. */
  avgEntryUsd: number | null;
  pnl: Pnl;
  /** When PANDA last saw a trade of this coin by the wallet (ms), if any. */
  lastTradeTs?: number;
};

export function buildRows(holdings: PortfolioHolding[], open: Position[]): TokenRow[] {
  const byMint = new Map(open.map((p) => [p.mint, p]));
  return holdings.map((h) => {
    const base = {
      mint: h.mint,
      symbol: h.symbol,
      name: h.name,
      image: h.image,
      amount: h.amount,
      priceUsd: h.priceUsd,
      valueUsd: h.valueUsd,
      changePct: h.changePct,
    };
    if (h.mint === NATIVE_MINT) return { ...base, avgEntryUsd: null, pnl: { kind: "unavailable", reason: "not_tracked" } as Pnl };

    const pos = byMint.get(h.mint);
    if (!pos || !(pos.avgCostUsd > 0) || !(pos.remainingTokens > 0)) {
      return { ...base, avgEntryUsd: null, pnl: { kind: "unavailable", reason: "no_trades" } as Pnl, lastTradeTs: pos?.lastTradeTs };
    }
    if (h.priceUsd === undefined) {
      return { ...base, avgEntryUsd: pos.avgCostUsd, pnl: { kind: "unavailable", reason: "no_price" } as Pnl, lastTradeTs: pos.lastTradeTs };
    }

    const coverage = Math.min(pos.remainingTokens, h.amount) / Math.max(pos.remainingTokens, h.amount);
    const exact = !pos.estimated && !pos.partialHistory && coverage >= COVERAGE_TOLERANCE;
    return {
      ...base,
      avgEntryUsd: pos.avgCostUsd,
      pnl: {
        kind: exact ? "tracked" : "estimated",
        usd: (h.priceUsd - pos.avgCostUsd) * h.amount,
        pct: (h.priceUsd / pos.avgCostUsd - 1) * 100,
      } as Pnl,
      lastTradeTs: pos.lastTradeTs,
    };
  });
}

export type PnlTotal = { usd: number; pct: number | null; kind: "tracked" | "estimated" };

export type Summary = {
  /** Sum of the priced holdings; null when nothing could be priced. */
  valueUsd: number | null;
  pricedCount: number;
  unpricedCount: number;
  /** Open holdings with a known cost basis and price. Null when there are none. */
  unrealized: (PnlTotal & { coveredCount: number; excludedCount: number }) | null;
  /** Profit locked in by sells, across every coin ever sold. Null when nothing was sold. */
  realized: Pick<PnlTotal, "usd" | "kind"> | null;
};

export function summarize(rows: TokenRow[], positions: Position[]): Summary {
  const priced = rows.filter((r) => r.valueUsd !== undefined);
  const valueUsd = priced.length ? priced.reduce((s, r) => s + (r.valueUsd as number), 0) : null;

  const covered = rows.filter((r): r is TokenRow & { pnl: Extract<Pnl, { usd: number }> } => r.pnl.kind !== "unavailable");
  const excluded = rows.filter((r) => r.pnl.kind === "unavailable" && r.pnl.reason !== "not_tracked").length;
  let unrealized: Summary["unrealized"] = null;
  if (covered.length) {
    const usd = covered.reduce((s, r) => s + r.pnl.usd, 0);
    const cost = covered.reduce((s, r) => s + (r.avgEntryUsd as number) * r.amount, 0);
    unrealized = {
      usd,
      pct: cost > 0 ? (usd / cost) * 100 : null,
      kind: covered.every((r) => r.pnl.kind === "tracked") && excluded === 0 ? "tracked" : "estimated",
      coveredCount: covered.length,
      excludedCount: excluded,
    };
  }

  const sold = positions.filter((p) => p.realizedPnlUsd !== 0 || (p.remainingTokens === 0 && p.lastTradeTs > 0));
  const realized: Summary["realized"] = sold.length
    ? {
        usd: sold.reduce((s, p) => s + p.realizedPnlUsd, 0),
        kind: sold.some((p) => p.estimated || p.partialHistory) ? "estimated" : "tracked",
      }
    : null;

  return { valueUsd, pricedCount: priced.length, unpricedCount: rows.length - priced.length, unrealized, realized };
}

export type Slice = { key: string; label: string; valueUsd: number; /** Whole basis points; every allocation sums to exactly 10 000. */ bps: number; other?: boolean };

/** The biggest priced holdings as shares of the priced total, the rest grouped as "other". Integer bps that always add up to 10 000. */
export function allocation(rows: TokenRow[], maxSlices = 5): Slice[] {
  const priced = rows.filter((r) => (r.valueUsd ?? 0) > 0).sort((a, b) => (b.valueUsd as number) - (a.valueUsd as number));
  const total = priced.reduce((s, r) => s + (r.valueUsd as number), 0);
  if (!(total > 0)) return [];

  const top = priced.slice(0, maxSlices).map((r) => ({ key: r.mint, label: r.symbol ? `$${r.symbol}` : r.mint.slice(0, 4), valueUsd: r.valueUsd as number }));
  const rest = priced.slice(maxSlices);
  const slices: { key: string; label: string; valueUsd: number; other?: boolean }[] = [...top];
  if (rest.length) slices.push({ key: "other", label: "other", valueUsd: rest.reduce((s, r) => s + (r.valueUsd as number), 0), other: true });

  // Largest-remainder rounding: floor everything, then hand the leftover basis points to the biggest remainders.
  const exact = slices.map((s) => (s.valueUsd / total) * 10_000);
  const bps = exact.map(Math.floor);
  let left = 10_000 - bps.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) bps[order[k].i]++;
  return slices.map((s, i) => ({ ...s, bps: bps[i] }));
}

/** Sums a wallet's entries over several rewards ledgers (lamports, exact integers). */
export function sumRewards(
  ledgers: { holders: Record<string, { entitledLamports: number; claimedLamports: number }> }[],
  wallet: string
): { earnedLamports: number; claimedLamports: number; claimableLamports: number; coins: number } {
  let earned = 0;
  let claimed = 0;
  let claimable = 0;
  let coins = 0;
  for (const l of ledgers) {
    const e = Object.prototype.hasOwnProperty.call(l.holders, wallet) ? l.holders[wallet] : undefined;
    if (!e) continue;
    coins++;
    earned += e.entitledLamports;
    claimed += e.claimedLamports;
    claimable += Math.max(0, e.entitledLamports - e.claimedLamports);
  }
  return { earnedLamports: earned, claimedLamports: claimed, claimableLamports: claimable, coins };
}
