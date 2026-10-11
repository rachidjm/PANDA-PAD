/**
 * "The current price" that Draw Your Trade compares every line with — the distance shown on a line's card and the
 * checks that say a price is too close, on the wrong side or absurdly far.
 *
 * It must be the coin's real price right now, and no single source is trusted to say so alone: a price feed can
 * answer with another pool's figure, a stale one or one in another unit, and then a line 9% away reads as billions of
 * percent away and signing is blocked. So the sources vouch for each other: a figure is used when another one agrees
 * with it (within a factor of two — they are read seconds apart on coins that move fast). When none agree, the price
 * the page itself shows wins, then the chart's last close, then the feed.
 */

const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Two readings of the same price: within a factor of two of each other. */
export const pricesAgree = (a: number, b: number) => Math.max(a, b) / Math.min(a, b) <= 2;

export type PriceSources = {
  /** The quote feed (/api/strategy/quote). */
  quote?: number | null;
  /** The live price the coin's page shows as its headline. */
  live?: number | null;
  /** The last close of the chart the lines are drawn on. */
  chart?: number | null;
};

export function referencePrice(s: PriceSources): number | null {
  const named: [keyof PriceSources, number][] = [];
  for (const k of ["quote", "live", "chart"] as const) if (valid(s[k])) named.push([k, s[k] as number]);
  if (named.length === 0) return null;
  if (named.length === 1) return named[0][1];
  // The first figure (feed, page, chart — in that order) that another one vouches for.
  for (const [k, v] of named) if (named.some(([o, w]) => o !== k && pricesAgree(v, w))) return v;
  // Nobody agrees with anybody: what the user is looking at.
  const by = Object.fromEntries(named) as PriceSources;
  return by.live ?? by.chart ?? by.quote ?? null;
}

/** True when the feed's own figure was set aside (it disagreed with the others): worth a line in the log. */
export const quoteWasOverruled = (s: PriceSources) => valid(s.quote) && referencePrice(s) !== s.quote;
