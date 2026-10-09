/** What the bot knows about a coin — every number either real (from PANDA's own data sources) or null, never guessed. */
export type CoinInfo = {
  mint: string;
  ticker: string;
  name: string;
  image: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  change24h: number | null;
  volume24h: number | null;
  /** The main pool's address, when known (the $PANDA buys feed reads its trades). */
  pool?: string | null;
};

export type Quote = { priceUsd: number | null; marketCap: number | null };

/**
 * The data the bot reads (src/lib/telegram/deps.ts wires the real one; tests a fake). Sources are listed in docs/TELEGRAM.md §0.
 */
export type Market = {
  /** One coin by address: PANDA's own coin-page data (getLiveCoin). */
  coin(mint: string): Promise<CoinInfo | null>;
  /** Coins whose name/ticker matches (GeckoTerminal search, as PANDA's own search). */
  search(query: string): Promise<CoinInfo[]>;
  /** PANDA's cached coin list, by 24h volume (the home page's "trending" order). */
  mostTraded(n: number): Promise<CoinInfo[]>;
  /** Live price + market cap for many coins: the cached list first, one batched Dexscreener call for the rest. */
  quotes(mints: string[]): Promise<Map<string, Quote>>;
  /** Coins launched through PANDA (panda_launches), newest first. */
  pandaLaunches(n: number): Promise<(CoinInfo & { launchedAt: number })[]>;
};
