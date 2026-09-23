export type DoodleKind = "cat" | "frog" | "donut" | "ghost" | "egg" | "cloud" | "fish" | "worm";

export type CoinSource = "pump-fun" | "pumpswap" | "other";

/** Why a coin's numbers can't be trusted — see src/lib/market/quality.ts. */
export type QualityReason =
  | "invalid_data"
  | "no_liquidity_data"
  | "low_liquidity"
  | "mc_over_liquidity"
  | "extreme_change_low_liquidity"
  | "curve_mc_too_high"
  | "sources_disagree";

/** The market cap each independent source reported for the same coin, when it gave one (USD). */
export type SourceMarketCaps = { pump?: number; dex?: number; gecko?: number };

export type Coin = {
  mint: string;
  ticker: string;
  name: string;
  description: string;
  /** Real token logo, when the source API has one. Falls back to a Doodle when absent. */
  image?: string;
  doodle: DoodleKind;
  bg: string;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  marketCap: number;
  volume24h: number;
  changePct: number;
  priceHistory: number[];
  creator: string;
  createdAt: string;
  /** True when `createdAt` is the coin's real Pump.fun launch time (otherwise it's when its pool was created). */
  launchVerified?: boolean;
  source: CoinSource;
  /** Raw dex id from the data source (e.g. "raydium", "orca") when source is "other". */
  dex?: string;
  poolAddress?: string;
  /** Quote asset symbol for the trading pair (e.g. "SOL"), when known. */
  quoteSymbol?: string;
  liquidityUsd?: number;
  /** Per-window market activity, only populated where the upstream data has it. */
  activity?: Partial<Record<"m5" | "h1" | "h24", TxWindow>>;
  volumeWindows?: Partial<Record<"m5" | "h1" | "h24", number>>;
  changeWindows?: Partial<Record<"m5" | "h1" | "h24", number>>;
  range24h?: { low: number; high: number };
  /** Set by the data-quality filter. A "suspect" coin is never deleted: it is kept, marked, and left out of the public lists. */
  quality?: "ok" | "suspect";
  qualityReasons?: QualityReason[];
  sourceMarketCaps?: SourceMarketCaps;
};

export type TxWindow = { buys: number; sells: number; buyers: number; sellers: number };

export type Trade = {
  id: string;
  side: "buy" | "sell";
  trader: string;
  sol: number;
  tokens: number;
  time: string;
  txHash?: string;
};

/** A real trade, tagged with the coin it happened on — powers the platform-wide activity feed. */
export type ActivityEvent = Trade & {
  ts: number;
  coinMint: string;
  coinTicker: string;
  coinImage?: string;
  coinDoodle: DoodleKind;
  coinBg: string;
};

/** One real, non-zero balance found in a connected wallet — read live from Solana, never stored. */
export type PortfolioHolding = {
  mint: string;
  amount: number;
  decimals: number;
  symbol?: string;
  name?: string;
  image?: string;
  doodle?: DoodleKind;
  bg?: string;
  /** Only set when a real price was found (PANDA-tracked coin or a GeckoTerminal-indexed pool). */
  priceUsd?: number;
  valueUsd?: number;
  changePct?: number;
};

/** A single real on-chain creator-fee recipient, in basis points (10,000 = 100%). */
export type Shareholder = { address: string; shareBps: number };

/**
 * A held coin with a nonzero on-chain Holders fee share. Deliberately has no
 * dollar/token reward *amount* field: PANDA's Rewards Pool wallet is shared
 * across every coin that opts into Fee Distribution, so a live pool balance
 * can't be honestly split per-coin without per-mint on-chain distribution
 * history (not implemented yet) — splitting the shared balance by live
 * ownership alone would double-count across coins and misrepresent a real
 * number, which is worse than not showing one. `holderSharePct` and
 * `holdersFeeBps` are both real, independently-verifiable on-chain facts.
 */
export type RewardSource = {
  coinMint: string;
  coinTicker: string;
  coinImage?: string;
  coinDoodle: DoodleKind;
  coinBg: string;
  holderBalance: number;
  circulatingSupply: number;
  /** holderBalance / circulatingSupply, as a percentage. */
  holderSharePct: number;
  /** This coin's real on-chain "Holders" allocation, in basis points. */
  holdersFeeBps: number;
  /** Real USD value of the held balance, when a price was found — used to enforce the real
   *  MIN_HOLDING_USD_FOR_REWARDS eligibility threshold, not just display it. */
  holderValueUsd?: number;
};
