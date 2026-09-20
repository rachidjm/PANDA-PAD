import { ACTIVITY_CONFIG as C } from "./config";
import { mergeFeed } from "./feed";
import type { CoinMeta, FeedEvent, FeedFilter, StoredEvent } from "./types";

/**
 * Gathers the feed from its sources and reports honestly which of them answered. Every source is behind
 * this small interface: the journal is PANDA's own record; the market indexer (today GeckoTerminal and
 * Pump.fun's public API) can be replaced without touching anything else.
 */

export type FeedDeps = {
  now: () => number;
  /** Events PANDA verified on-chain itself. */
  journal: (now: number) => Promise<StoredEvent[]>;
  /** Recent trades — of the most active coins, or of one coin when `mint` is given. */
  trades: (mint?: string) => Promise<FeedEvent[]>;
  launches: () => Promise<FeedEvent[]>;
  graduations: () => Promise<FeedEvent[]>;
  /** Names and logos for coins the events don't already describe. */
  meta: (mints: string[]) => Promise<Map<string, CoinMeta>>;
};

export type SourceStatus = "ok" | "unavailable";
export type FeedResult = {
  events: FeedEvent[];
  sources: { journal: SourceStatus; trades: SourceStatus; launches: SourceStatus; graduations: SourceStatus };
  generatedAt: number;
};

async function attempt<T>(fn: () => Promise<T[]>): Promise<{ items: T[]; status: SourceStatus }> {
  try {
    return { items: await fn(), status: "ok" };
  } catch {
    return { items: [], status: "unavailable" };
  }
}

export async function getFeed(deps: FeedDeps, opts: { filter?: FeedFilter; mint?: string; limit?: number } = {}): Promise<FeedResult> {
  const now = deps.now();
  const [journal, trades, launches, graduations] = await Promise.all([
    attempt(() => deps.journal(now)),
    attempt(() => deps.trades(opts.mint)),
    attempt(() => deps.launches()),
    attempt(() => deps.graduations()),
  ]);

  // Journal first: an event PANDA verified wins over the same event read from an indexer.
  const lists = [journal.items, trades.items, launches.items, graduations.items];
  const undescribed = new Set<string>();
  for (const list of lists) for (const e of list) if (!("ticker" in e && e.ticker)) undescribed.add(e.mint);

  let meta = new Map<string, CoinMeta>();
  if (undescribed.size > 0) {
    try {
      meta = await deps.meta([...undescribed].slice(0, 60));
    } catch {
      /* events without a name simply show their address */
    }
  }

  return {
    events: mergeFeed({ lists: lists as FeedEvent[][], filter: opts.filter, mint: opts.mint, limit: opts.limit, now, meta }),
    sources: { journal: journal.status, trades: trades.status, launches: launches.status, graduations: graduations.status },
    generatedAt: now,
  };
}

/** Small time-boxed cache so a busy page doesn't call the indexers on every request. */
export function cached<T>(ttlMs: number = C.cacheMs, max: number = 50) {
  const store = new Map<string, { at: number; value: T }>();
  return async (key: string, make: () => Promise<T>, now = Date.now()): Promise<T> => {
    const hit = store.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    const value = await make();
    if (store.size >= max) store.delete(store.keys().next().value as string);
    store.set(key, { at: now, value });
    return value;
  };
}
