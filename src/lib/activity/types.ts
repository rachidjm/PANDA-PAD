/**
 * The activity feed's data model. One event = one thing that really happened on-chain,
 * with the transaction it can be checked against. Amounts are integer lamports.
 */

export const FEED_KINDS = ["token_created", "buy", "sell", "fee_distribution", "reward_claim", "graduation"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

export type FeedEvent = {
  /** Deterministic from what happened (`trade:<sig>`, `fees:<sig>`, `claim:<sig>`, `created:<mint>`, `grad:<mint>`), so the same event from two sources is one event. */
  id: string;
  kind: FeedKind;
  /** When it happened on-chain (ms). */
  ts: number;
  mint: string;
  /** Trader, claimer or creator. */
  wallet?: string;
  /** SOL moved, in lamports: the trade size, the fees distributed, or the reward paid. */
  lamports?: number;
  /** Token amount in UI units (trades). */
  tokenAmount?: number;
  /** The transaction to check it against. Absent for events the chain doesn't put in one transaction (a launch's time, a graduation). */
  signature?: string;
  /** True when PANDA itself verified the transaction on-chain before recording it (as opposed to reading it from a public indexer). */
  verified?: boolean;
  /** Set when building the feed: a trade at or above the large-trade threshold. Never stored. */
  large?: boolean;
  /** Filled in when reading, from current coin data. Never stored. */
  ticker?: string;
  name?: string;
  image?: string;
};

/** The fields that may be stored in the journal — presentation fields are never persisted. */
export type StoredEvent = Omit<FeedEvent, "large" | "ticker" | "name" | "image">;

export type CoinMeta = { ticker?: string; name?: string; image?: string };

/** What the UI's filter chips ask for. */
export const FEED_FILTERS = ["all", "created", "trades", "large", "graduation", "fees", "rewards"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];
