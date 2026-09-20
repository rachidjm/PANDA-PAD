import { DoodleKind } from "@/lib/types";
import { LoggedTrade } from "./trade-log";

export type Position = {
  mint: string;
  ticker: string;
  coinImage?: string;
  coinDoodle?: DoodleKind;
  coinBg?: string;
  /** Recent closes of the coin's price, for a mini chart (real hourly closes when available, else the % -window shape used on the coin cards). */
  priceHistory?: number[];
  /** Remaining real token balance implied by the trade log (0 for a closed position). */
  remainingTokens: number;
  /** Average USD cost per token across every buy still contributing to `remainingTokens`. */
  avgCostUsd: number;
  /** Real USD P&L: unrealized (open) from the live price, or realized (closed) from actual sells. */
  pnlUsd: number;
  pnlPct: number;
  lastTradeTs: number;
  /** True when any of this position's trades were read back from on-chain history (approximate). */
  estimated?: boolean;
};

/**
 * Average-cost-basis position math (disclosed, not FIFO/specific-lot) over a
 * wallet's real logged trades. Pure function — no network calls, no
 * invented numbers: `currentPriceUsd` is the only external input, and it's
 * only used for an open position's unrealized P&L.
 */
export function computePositions(
  trades: LoggedTrade[],
  currentPriceByMint: Record<string, number | undefined>,
  coinMeta: Record<string, { image?: string; doodle?: DoodleKind; bg?: string; priceHistory?: number[] }>
): { open: Position[]; closed: Position[] } {
  const byMint = new Map<string, LoggedTrade[]>();
  for (const t of trades) {
    if (!byMint.has(t.mint)) byMint.set(t.mint, []);
    byMint.get(t.mint)!.push(t);
  }

  const open: Position[] = [];
  const closed: Position[] = [];

  for (const [mint, mintTrades] of byMint) {
    const sorted = [...mintTrades].sort((a, b) => a.ts - b.ts);
    let totalTokens = 0;
    let totalCostUsd = 0;
    let realizedPnlUsd = 0;
    let realizedCostUsd = 0; // sum of cost-of-sold, for a closed position's % P&L
    let lastTradeTs = 0;
    const estimated = sorted.some((t) => t.estimated);

    for (const t of sorted) {
      lastTradeTs = Math.max(lastTradeTs, t.ts);
      const usdAmount = t.solAmount * t.solPriceUsdAtTrade;
      if (t.side === "buy") {
        totalTokens += t.tokenAmount;
        totalCostUsd += usdAmount;
      } else {
        const avgCost = totalTokens > 0 ? totalCostUsd / totalTokens : 0;
        const sold = Math.min(t.tokenAmount, totalTokens);
        if (sold <= 0) continue; // a sale of tokens we never saw bought (e.g. before the scanned history) has no known cost basis
        const costOfSold = avgCost * sold;
        // Only the part of the sale we can match to known purchases counts, along with its share of the proceeds.
        realizedPnlUsd += usdAmount * (sold / t.tokenAmount) - costOfSold;
        realizedCostUsd += costOfSold;
        totalTokens = Math.max(0, totalTokens - sold);
        totalCostUsd = Math.max(0, totalCostUsd - costOfSold);
      }
    }

    const meta = coinMeta[mint.toLowerCase()] || {};
    const ticker = sorted[sorted.length - 1]?.ticker || mint;

    if (totalTokens > 1e-9) {
      const avgCostUsd = totalCostUsd / totalTokens;
      const currentPriceUsd = currentPriceByMint[mint.toLowerCase()];
      const currentValueUsd = currentPriceUsd !== undefined ? currentPriceUsd * totalTokens : totalCostUsd;
      const pnlUsd = currentPriceUsd !== undefined ? currentValueUsd - totalCostUsd : 0;
      open.push({
        mint,
        ticker,
        coinImage: meta.image,
        coinDoodle: meta.doodle,
        coinBg: meta.bg,
        priceHistory: meta.priceHistory,
        remainingTokens: totalTokens,
        avgCostUsd,
        pnlUsd,
        pnlPct: totalCostUsd > 0 ? (pnlUsd / totalCostUsd) * 100 : 0,
        lastTradeTs,
        estimated,
      });
    } else if (sorted.length > 0) {
      closed.push({
        mint,
        ticker,
        coinImage: meta.image,
        coinDoodle: meta.doodle,
        coinBg: meta.bg,
        priceHistory: meta.priceHistory,
        remainingTokens: 0,
        avgCostUsd: 0,
        pnlUsd: realizedPnlUsd,
        pnlPct: realizedCostUsd > 0 ? (realizedPnlUsd / realizedCostUsd) * 100 : 0,
        lastTradeTs,
        estimated,
      });
    }
  }

  return { open, closed };
}
