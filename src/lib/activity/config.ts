/** Every tunable number of the activity feed, in one place. */
export const ACTIVITY_CONFIG = {
  /** A trade at or above this is flagged "large" (lamports): 5 SOL. */
  largeTradeLamports: 5_000_000_000,
  /** Trades smaller than this (lamports, 0.01 SOL) are dust and are left out. */
  minTradeLamports: 10_000_000,
  /** In the "all" view, trades take at most this share of the feed so launches, graduations, fees and rewards aren't buried. */
  allViewTradeShare: 0.6,
  /** Events older than this are not shown (the feed is "recent", not a history). */
  maxAgeMs: 3 * 24 * 3_600_000,
  /** An event dated further than this into the future is dropped (bad clock / bad data). */
  maxFutureMs: 5 * 60_000,
  /** Days of journal files read per request. */
  journalDays: 3,
  /** Most events kept in one journal day (bounds a document's size). */
  journalDayCap: 2_000,
  /** Feed size. */
  defaultLimit: 50,
  maxLimit: 100,
  /** Market indexer: how many of the most active coins have their latest trades read, and how many trades of each. */
  marketCoins: 8,
  tradesPerCoin: 6,
  /** Newly launched coins are only listed once they have this much traction (USD market cap) — the raw launch stream is mostly dust. */
  launchMinMarketCapUsd: 8_000,
  /** A pool created within this long ago counts as a recent graduation. */
  graduationWindowMs: 72 * 3_600_000,
  /** The public feed is cached this long per query (ms). */
  cacheMs: 20_000,
} as const;
