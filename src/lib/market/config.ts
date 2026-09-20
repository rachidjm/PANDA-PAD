/**
 * Marketplace parameters — one place, integer-only, and DISCLOSED to users
 * before they sign (the buy screen shows the exact split).
 */
export const MARKET_CONFIG = {
  /** PANDA's marketplace fee on every sale, in basis points (2%). Not on the creator's royalty. */
  feeBps: 200,
  /** Smallest and largest listing price, in lamports (0.001 SOL – 1,000 SOL). */
  minPriceLamports: 1_000_000,
  maxPriceLamports: 1_000_000_000_000,
  /** A listing lasts between 1 hour and 30 days. */
  minListingMs: 3_600_000,
  maxListingMs: 30 * 24 * 3_600_000,
  /** The buyer's transaction is only signed for this long (the blockhash also expires on its own). */
  saleIntentTtlMs: 5 * 60_000,
} as const;
