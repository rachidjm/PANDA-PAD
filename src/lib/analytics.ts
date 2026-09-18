import { Coin } from "./types";

export type RealStats = {
  totalVolume: number;
  totalMarketCap: number;
  tokensTracked: number;
  activeTokens: number;
  graduatedTokens: number;
};

/** All real sums/counts over the already-fetched coin list — nothing invented. */
export function computeRealStats(coins: Coin[]): RealStats {
  let totalVolume = 0;
  let totalMarketCap = 0;
  let activeTokens = 0;
  let graduatedTokens = 0;

  for (const c of coins) {
    totalVolume += c.volume24h;
    totalMarketCap += c.marketCap;
    if (c.source === "pumpswap") graduatedTokens++;
    const w = c.activity?.h1 || c.activity?.m5;
    if (w && w.buys + w.sells > 0) activeTokens++;
  }

  return { totalVolume, totalMarketCap, tokensTracked: coins.length, activeTokens, graduatedTokens };
}

export type BarPoint = { label: string; value: number };

/** Real total trading volume by window, summed across every tracked coin. */
export function computeWindowVolume(coins: Coin[]): BarPoint[] {
  const windows: Array<{ key: "m5" | "h1" | "h24"; label: string }> = [
    { key: "m5", label: "5m" },
    { key: "h1", label: "1h" },
    { key: "h24", label: "24h" },
  ];
  return windows.map(({ key, label }) => ({
    label,
    value: coins.reduce((sum, c) => sum + (c.volumeWindows?.[key] || 0), 0),
  }));
}

/** Real count of tracked coins by how recently they launched. */
export function computeLaunchRecency(coins: Coin[]): BarPoint[] {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const buckets = [
    { label: "< 1h", max: hour },
    { label: "1-6h", max: 6 * hour },
    { label: "6-24h", max: 24 * hour },
    { label: "> 24h", max: Infinity },
  ];
  const counts = buckets.map((b) => ({ label: b.label, value: 0 }));

  for (const c of coins) {
    const age = now - new Date(c.createdAt).getTime();
    const idx = buckets.findIndex((b) => age <= b.max);
    counts[idx === -1 ? counts.length - 1 : idx].value++;
  }
  return counts;
}
