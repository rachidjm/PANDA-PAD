/**
 * Is a PumpSwap pool really a pool where SOL buys THIS token? A pool pairs the token with SOL in one of TWO orders, and
 * both are real, deep pools: the usual one (token = "base", SOL = "quote") and the other way round (SOL = "base", token =
 * "quote"; anyone can create a pool either way, and several well-known coins trade that way with millions in liquidity).
 * What differs is which side of the pool a buy or a sell must be built on (see amm-trade.ts). What can never work is a pool
 * that doesn't pair this token with SOL at all, or one that holds next to nothing (dust pools made to look like listings):
 * a transaction for those only costs the wallet a network fee. Checked before any transaction is built.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
/** A pool holding less SOL than this (0.05 SOL) is treated as empty: there is nothing real to trade against. */
export const MIN_POOL_SOL_LAMPORTS = BigInt("50000000");

export type PoolView = { baseMint: string; quoteMint: string; baseReserve: bigint | number | string | { toString(): string }; quoteReserve: bigint | number | string | { toString(): string } };

const big = (v: PoolView["baseReserve"]): bigint => {
  try {
    return BigInt(v.toString());
  } catch {
    return BigInt("0");
  }
};

/** "token-base": token/SOL (the usual order). "token-quote": SOL/token (the other way round). null: not a pool of this token against SOL. */
export type PoolOrientation = "token-base" | "token-quote";

export function poolOrientation(pool: Pick<PoolView, "baseMint" | "quoteMint">, tokenMint: string): PoolOrientation | null {
  if (pool.baseMint === tokenMint && pool.quoteMint === WSOL_MINT) return "token-base";
  if (pool.baseMint === WSOL_MINT && pool.quoteMint === tokenMint) return "token-quote";
  return null;
}

/** null when the pool can be traded with SOL; otherwise a short reason. */
export function ammPoolProblem(pool: PoolView, tokenMint: string): string | null {
  const orientation = poolOrientation(pool, tokenMint);
  if (!orientation) return "this pool doesn't pair this coin with SOL";
  const solReserve = big(orientation === "token-base" ? pool.quoteReserve : pool.baseReserve);
  const tokenReserve = big(orientation === "token-base" ? pool.baseReserve : pool.quoteReserve);
  if (solReserve < MIN_POOL_SOL_LAMPORTS || tokenReserve <= BigInt("0")) return "this pool has (almost) no SOL in it";
  return null;
}

export const POOL_NOT_TRADABLE = "This coin's PumpSwap pool can't be traded with SOL right now";
