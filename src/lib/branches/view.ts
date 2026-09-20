import { isEnabled } from "@/lib/config/flags";
import { listBranchPublished } from "@/lib/nft/store";
import { listActive, listSales } from "@/lib/market/store";
import { MARKET_CONFIG } from "@/lib/market/config";
import type { Branch } from "./branch";

/** The public shape of a branch. Only wallet addresses that are public on-chain anyway; nothing private. */
export const publicBranch = (b: Branch, nfts: number) => ({
  branchId: b.branchId,
  slug: b.slug,
  themeId: b.themeId,
  themeSlug: b.themeSlug,
  themeTitle: b.themeTitle,
  title: b.title,
  description: b.description,
  creator: b.creator,
  contributors: b.contributors,
  status: b.status,
  rootAsset: b.rootAsset,
  eligibility: b.eligibility,
  createdAt: b.createdAt,
  nfts,
});
export type PublicBranch = ReturnType<typeof publicBranch>;

/**
 * A branch's NFTs the way the theme page shows its own — chain-verified ones only, with owner, sales and any active
 * listing when the market is on. Branch NFTs trade in their parent theme's market (that is where their sales and
 * listings are recorded), so the market data is read from the theme and filtered to this branch's assets.
 */
export async function branchNftViews(b: Branch, now: number) {
  const items = (await listBranchPublished(b.branchId)).sort((x, y) => (x.serial ?? 0) - (y.serial ?? 0));
  const marketOn = isEnabled("NFT_MARKET");
  const ownerOf = new Map<string, string>();
  const salesOf = new Map<string, number>();
  const listingOf = new Map<string, { listingId: string; priceLamports: number; expiresAt: number; seller: string }>();
  if (marketOn) {
    const [sales, active] = await Promise.all([listSales(b.themeId), listActive(b.themeId, now)]);
    for (const s of sales.filter((x) => x.status === "COMPLETED")) {
      ownerOf.set(s.assetAddress, s.buyer);
      salesOf.set(s.assetAddress, (salesOf.get(s.assetAddress) ?? 0) + 1);
    }
    for (const a of active) listingOf.set(a.assetAddress, { listingId: a.listingId, priceLamports: a.priceLamports, expiresAt: a.expiresAt, seller: a.seller });
  }
  return {
    market: marketOn ? { enabled: true, secondaryEnabled: isEnabled("NFT_SECONDARY"), feeBps: MARKET_CONFIG.feeBps } : { enabled: false, secondaryEnabled: false, feeBps: 0 },
    nfts: items.map((i) => ({
      owner: ownerOf.get(i.assetAddress) ?? i.wallet,
      sales: salesOf.get(i.assetAddress) ?? 0,
      listing: listingOf.get(i.assetAddress) ?? null,
      contentId: i.contentId,
      asset: i.assetAddress,
      creator: i.wallet,
      name: i.name,
      imageUrl: i.imageUrl,
      signature: i.signature,
      publishedAt: i.publishedAt,
      review: i.review,
    })),
  };
}
