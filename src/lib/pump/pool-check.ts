/**
 * Is a PumpSwap pool really a pool where SOL buys THIS token? Pool listings (from public indexers) include pools that
 * were created the other way round (SOL as the "base", the token as the "quote") or that hold next to nothing; a SOL
 * buy built for such a pool can never succeed, and finding that out means the wallet pays a network fee for nothing.
 * Checked before any transaction is built.
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

/** null when the pool can be traded with SOL; otherwise a short reason. */
export function ammPoolProblem(pool: PoolView, tokenMint: string): string | null {
  if (pool.baseMint !== tokenMint || pool.quoteMint !== WSOL_MINT) {
    return "this pool isn't set up as token/SOL (it is the other way round or pairs a different token)";
  }
  if (big(pool.quoteReserve) < MIN_POOL_SOL_LAMPORTS || big(pool.baseReserve) <= BigInt("0")) {
    return "this pool has (almost) no SOL in it";
  }
  return null;
}

export const POOL_NOT_TRADABLE = "This coin's PumpSwap pool can't be traded with SOL right now";
