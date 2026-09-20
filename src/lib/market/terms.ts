import { MARKET_CONFIG } from "./config";

/**
 * The listing terms a seller signs with their wallet (a free message signature).
 * The server stores that signature and re-verifies it every time it is about to
 * sign a sale: a price edited in the database, or a listing the seller never
 * made, can't produce a valid sale. The message names the domain, the asset, the
 * exact price and an expiry, so it can't be replayed elsewhere or for another NFT.
 */

export type ListingTerms = {
  domain: string;
  asset: string;
  seller: string;
  priceLamports: number;
  expiresAt: number;
  nonce: string;
};

export function buildListingMessage(t: ListingTerms): string {
  return [
    "PANDA Market — list an NFT for sale",
    "",
    `Domain: ${t.domain}`,
    `Asset: ${t.asset}`,
    `Seller: ${t.seller}`,
    `Price: ${t.priceLamports} lamports`,
    `Expires: ${new Date(t.expiresAt).toISOString()}`,
    `Nonce: ${t.nonce}`,
    "",
    "Signing is free and moves no funds. It lets PANDA sell this NFT for exactly this price until it expires or you cancel.",
  ].join("\n");
}

export function validateTerms(t: { priceLamports: unknown; expiresAt: unknown }, now: number): string | null {
  const { priceLamports, expiresAt } = t;
  if (!Number.isSafeInteger(priceLamports) || (priceLamports as number) < MARKET_CONFIG.minPriceLamports || (priceLamports as number) > MARKET_CONFIG.maxPriceLamports) {
    return "Price is outside the allowed range (0.001–1,000 SOL).";
  }
  if (!Number.isSafeInteger(expiresAt)) return "Invalid expiry.";
  const ttl = (expiresAt as number) - now;
  if (ttl < MARKET_CONFIG.minListingMs || ttl > MARKET_CONFIG.maxListingMs) return "A listing must last between 1 hour and 30 days.";
  return null;
}
