/**
 * Where a coin's picture really comes from. Pump.fun coins keep theirs on IPFS, and the public IPFS gateways that
 * feeds link to are unreliable (`cf-ipfs.com` no longer answers at all, `ipfs.io` rate-limits, others take seconds),
 * which shows up as coins without a picture. Pump.fun serves the same picture from its own image CDN, quickly and
 * for every coin it launched, so that is used when a coin has no picture or only a gateway link.
 * Coins that aren't Pump.fun's keep whatever their feed gave (Dexscreener / GeckoTerminal CDNs, which are fine).
 */

export const pumpImageUrl = (mint: string) => `https://images.pump.fun/coin-image/${mint}?variant=600x600`;

const IPFS_GATEWAY = /^https?:\/\/(cf-ipfs\.com|cloudflare-ipfs\.com|ipfs\.io|dweb\.link|gateway\.ipfs\.io|gateway\.pinata\.cloud|nftstorage\.link|w3s\.link|ipfs\.filebase\.io)\//i;

export function isPumpCoin(c: { mint: string; source?: string }): boolean {
  return c.source === "pump-fun" || c.source === "pumpswap" || c.mint.endsWith("pump");
}

export function bestImage(c: { mint: string; source?: string; image?: string | null }): string | undefined {
  const pump = isPumpCoin(c);
  if (!c.image) return pump ? pumpImageUrl(c.mint) : undefined;
  if (pump && IPFS_GATEWAY.test(c.image)) return pumpImageUrl(c.mint);
  return c.image;
}

export function withBestImage<T extends { mint: string; source?: string; image?: string | null }>(c: T): T {
  const image = bestImage(c);
  return image === c.image ? c : { ...c, image };
}
