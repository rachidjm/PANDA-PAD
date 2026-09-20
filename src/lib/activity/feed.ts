import { ACTIVITY_CONFIG as C } from "./config";
import type { CoinMeta, FeedEvent, FeedFilter } from "./types";

/**
 * Builds the feed from any number of event lists: one event per id (earlier lists win, so PANDA-verified
 * journal events beat the same event read from an indexer), implausible timestamps dropped, large trades
 * flagged, filtered, newest first, bounded. Pure.
 */

const KINDS_OF: Record<Exclude<FeedFilter, "all" | "large">, FeedEvent["kind"][]> = {
  created: ["token_created"],
  trades: ["buy", "sell"],
  graduation: ["graduation"],
  fees: ["fee_distribution"],
  rewards: ["reward_claim"],
};

export function isLarge(e: Pick<FeedEvent, "kind" | "lamports">): boolean {
  return (e.kind === "buy" || e.kind === "sell") && (e.lamports ?? 0) >= C.largeTradeLamports;
}

export function mergeFeed(args: {
  lists: FeedEvent[][];
  filter?: FeedFilter;
  mint?: string;
  limit?: number;
  now: number;
  meta?: Map<string, CoinMeta>;
}): FeedEvent[] {
  const { now } = args;
  const limit = Math.min(C.maxLimit, Math.max(1, Math.floor(args.limit ?? C.defaultLimit)));
  const seen = new Set<string>();
  const out: FeedEvent[] = [];

  for (const list of args.lists) {
    for (const e of list) {
      if (seen.has(e.id)) continue;
      if (!Number.isFinite(e.ts) || e.ts > now + C.maxFutureMs || now - e.ts > C.maxAgeMs) continue;
      if (args.mint && e.mint !== args.mint) continue;
      if ((e.kind === "buy" || e.kind === "sell") && (e.lamports ?? 0) < C.minTradeLamports) continue;
      seen.add(e.id);
      const m = args.meta?.get(e.mint);
      const { large: _ignored, ...plain } = e; // "large" is always recomputed here, never trusted from a source
      void _ignored;
      out.push({
        ...plain,
        ticker: e.ticker ?? m?.ticker,
        name: e.name ?? m?.name,
        image: e.image ?? m?.image,
        ...(isLarge(e) ? { large: true } : {}),
      });
    }
  }

  const f = args.filter ?? "all";
  const kept = out.filter((e) => (f === "all" ? true : f === "large" ? e.large === true : KINDS_OF[f].includes(e.kind)));
  const newestFirst = (a: FeedEvent, b: FeedEvent) => b.ts - a.ts || (a.id < b.id ? -1 : 1);
  kept.sort(newestFirst);

  // Trades are by far the most frequent event. In the mixed view they are capped, so rarer and more telling events
  // (launches, graduations, fee distributions, rewards) stay visible; unused room goes back to trades.
  if (f === "all" && !args.mint) {
    const isTrade = (e: FeedEvent) => e.kind === "buy" || e.kind === "sell";
    const tradesAll = kept.filter(isTrade);
    const reserve = Math.min(Math.ceil(limit * C.allViewTradeShare), tradesAll.length);
    const others = kept.filter((e) => !isTrade(e)).slice(0, limit - reserve);
    return [...others, ...tradesAll.slice(0, limit - others.length)].sort(newestFirst);
  }
  return kept.slice(0, limit);
}
