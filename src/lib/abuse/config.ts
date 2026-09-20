/**
 * Every threshold of the abuse engine, in one place and under a version.
 * Changing a number means a new version (v2) — reports record the version
 * they ran under, so a past decision can always be re-read with the rules
 * that produced it. Deliberately conservative: it's far worse to punish an
 * honest user than to miss a small farmer.
 */

export const ABUSE_CONFIG_VERSION = "v1";

export const ABUSE_CONFIG = {
  version: ABUSE_CONFIG_VERSION,

  // ---- how scores map to statuses --------------------------------------------------
  score: {
    /** Below this: NORMAL. */
    review: 200,
    /** Proposing RESTRICTED needs score >= this AND at least 2 distinct signal families AND confidence >= restrictedMinConfidence. */
    restricted: 500,
    restrictedMinConfidence: 60,
    /** Proposing DISQUALIFIED: score >= this AND >= 2 families AND confidence >= disqualifiedMinConfidence. */
    disqualified: 800,
    disqualifiedMinConfidence: 70,
    /**
     * The most ONE family of evidence can add. It sits below the RESTRICTED line on purpose:
     * no single kind of signal — however strong — can push a wallet past REVIEW by itself.
     */
    maxPerFamily: 450,
    max: 1000,
  },

  // ---- NFT market: wash trading -------------------------------------------------------
  market: {
    /** A cycle (an NFT coming back to a previous owner) inside this window counts. */
    cycleWindowMs: 7 * 24 * 3_600_000,
    cyclePoints: 150,
    cyclePointsMax: 400,
    /** A wallet with >= this many sales where one counterparty is >= this share of its volume. */
    pairMinSales: 4,
    pairShareBps: 8000,
    pairPoints: 200,
    pairConfidence: 60,
    /** Bought then resold within this long, at least this many times. */
    flipWindowMs: 10 * 60_000,
    flipMinCount: 2,
    flipPoints: 200,
    flipConfidence: 65,
    /** Buyer and seller funded by the same wallet, or one funded the other: the strongest market signal. */
    clusterPoints: 350,
    clusterConfidence: 85,
  },

  // ---- bonding-curve trading ------------------------------------------------------------
  trade: {
    /** A buy followed by a sell of the same coin within this long, of similar size, is a round trip. */
    roundTripWindowMs: 5 * 60_000,
    roundTripSizeToleranceBps: 2000,
    /** Share of a wallet's volume that must be round trips, and the minimum absolute volume (lamports), to signal. */
    roundTripMinShareBps: 4000,
    roundTripMinLamports: 500_000_000,
    roundTripPointsMin: 100,
    roundTripPointsMax: 400,
    roundTripConfidence: 75,
    /** Many trades of exactly the same size. Weak on its own: plenty of honest people always buy the same amount. */
    uniformMinTrades: 8,
    uniformShareBps: 8000,
    uniformBucketLamports: 1_000_000,
    uniformPoints: 100,
    uniformConfidence: 40,
  },

  // ---- Sybil ---------------------------------------------------------------------------------
  sybil: {
    /**
     * Wallets first funded by the same address. Sizes at or below `minCluster` are ordinary; above
     * `hubSize` it is almost certainly an exchange or faucet funding thousands of unrelated people,
     * which says nothing about them — so no signal.
     */
    minCluster: 5,
    hubSize: 30,
    clusterPoints: 250,
    clusterConfidenceBase: 65,
    clusterConfidenceMax: 90,
    /** First seen this recently before the epoch ended (and we saw its true beginning). Weak. */
    newWalletMs: 3 * 24 * 3_600_000,
    newWalletPoints: 60,
    newWalletConfidence: 50,
    /**
     * A GROUP of at least this many wallets that keep making their first trade of the same coins inside the same
     * minute, across at least `syncMinCoins` different coins. Buying a hot launch in its first minute is normal for
     * honest users, so a single shared coin means nothing — only the same group, repeatedly, does.
     */
    syncMinWallets: 8,
    syncBucketMs: 60_000,
    syncMinCoins: 4,
    syncPoints: 300,
    syncConfidence: 60,
  },

  // ---- velocity ------------------------------------------------------------------------------
  velocity: {
    /** Events in an epoch at or above this share (bps) of the per-wallet event cap. */
    capShareBps: 9000,
    points: 80,
    confidence: 50,
  },

  /** Most wallets whose history is looked up on-chain in one analysis (each lookup costs RPC calls). */
  maxProfileLookups: 150,
  /** Most wallets analysed in one run (highest points first) — bounds storage reads inside a serverless time limit. */
  maxWalletsPerRun: 400,
  /** Stop starting new on-chain lookups after this long; the run finishes with what it has and says so. Cached profiles make the next run go further. */
  maxLookupMs: 18_000,
} as const;
