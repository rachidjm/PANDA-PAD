export type DoodleKind = "cat" | "frog" | "donut" | "ghost" | "egg" | "cloud" | "fish" | "worm";

export type CoinSource = "pump-fun" | "pumpswap";

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
  source: CoinSource;
  poolAddress?: string;
  /** Quote asset symbol for the trading pair (e.g. "SOL"), when known. */
  quoteSymbol?: string;
  liquidityUsd?: number;
  /** Per-window market activity, only populated where the upstream data has it. */
  activity?: Partial<Record<"m5" | "h1" | "h24", TxWindow>>;
  volumeWindows?: Partial<Record<"m5" | "h1" | "h24", number>>;
  changeWindows?: Partial<Record<"m5" | "h1" | "h24", number>>;
  range24h?: { low: number; high: number };
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
