/**
 * Every tunable number of the PANDA Points system, in one place and under a
 * version. Changing a value means a new version (v2): historical epochs keep
 * the version they were run under and are never recomputed retroactively.
 * All amounts are integers (lamports / points).
 */

export const POINTS_FORMULA_VERSION = "v1";

/** Only types with a formula below can be awarded; the rest are reserved for their own phases. */
export const POINT_TYPES = [
  "trade",
  "token_launch",
  "theme_participation",
  "nft_create",
  "nft_buy",
  "campaign",
  "early_participation",
  "correction",
] as const;
export type PointType = (typeof POINT_TYPES)[number];

export const POINTS_CONFIG = {
  version: POINTS_FORMULA_VERSION,

  /**
   * Trading. Points follow the SQUARE ROOT of a wallet's CUMULATIVE trade
   * volume in the epoch: points(V) = floor(sqrt(V / lamportsPerUnit)). 100x the
   * volume earns 10x the points. Each trade earns the difference
   * points(V + v) - points(V), so the total is the same however the volume is
   * split into trades — slicing one big trade into many small ones gains
   * nothing. (Splitting across many WALLETS still would; that's what the
   * anti-Sybil phase is for.) Trades under the minimum earn nothing and don't count.
   */
  trade: {
    minVolumeLamports: 50_000_000, // 0.05 SOL
    lamportsPerUnit: 1_000_000, // 0.001 SOL
  },

  caps: {
    /** Most points one wallet can earn from one type in one epoch. */
    perWalletPerEpochByType: {
      trade: 5_000,
      token_launch: 2_000,
      theme_participation: 2_000,
      nft_create: 2_000,
      nft_buy: 2_000,
      campaign: 5_000,
      early_participation: 5_000,
      correction: Number.MAX_SAFE_INTEGER, // admin-only, audited, not capped
    } satisfies Record<PointType, number>,
    /** Most points one wallet can earn in one epoch across all types (corrections excluded). */
    perWalletPerEpochTotal: 20_000,
    /** Most events stored per wallet per epoch — bounds storage and blunts spam. */
    maxEventsPerWallet: 500,
  },

  /** How long after snapshotTime an epoch must wait before it can leave ACTIVE, so in-flight events can still land. */
  snapshotGraceMs: 10 * 60_000,
} as const;
