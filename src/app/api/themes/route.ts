import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getThemeBySlug, listThemes } from "@/lib/themes/store";
import { displayStatus, Theme } from "@/lib/themes/theme";
import { listPublished } from "@/lib/nft/store";
import { MARKET_CONFIG } from "@/lib/market/config";
import { listActive, listSales } from "@/lib/market/store";
import { listBranchesOfTheme } from "@/lib/branches/store";

type Extra = { creators: number; volumeLamports: number | null; branches: number | null };
const publicTheme = (t: Theme, now: number, nfts: number, extra?: Extra) => ({
  themeId: t.themeId,
  slug: t.slug,
  title: t.title,
  description: t.description,
  banner: t.banner,
  rules: t.rules,
  startTime: t.startTime,
  endTime: t.endTime,
  creationLimit: t.creationLimit,
  royaltyBps: t.royaltyBps,
  rewardPool: t.rewardPool,
  status: displayStatus(t, now),
  version: t.version,
  nfts,
  ...(extra ?? {}),
});

/**
 * Auth: none (public). Without a query: every theme that isn't a draft.
 * With ?slug=: that theme plus its PUBLISHED NFTs (only ones verified on-chain).
 * Gated by NFT_THEMES.
 */
export async function GET(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const now = Date.now();
  const slug = new URL(req.url).searchParams.get("slug");
  try {
    if (slug) {
      const theme = await getThemeBySlug(slug);
      if (!theme || theme.status === "DRAFT") return NextResponse.json({ error: "No such theme." }, { status: 404 });
      const items = (await listPublished(theme.themeId)).sort((a, b) => b.publishedAt - a.publishedAt);

      // Market view (only when the market is on): who owns each NFT (the latest verified buyer, else its creator),
      // how many verified sales it has had, and its active listing.
      const marketOn = isEnabled("NFT_MARKET");
      const ownerOf = new Map<string, string>();
      const salesOf = new Map<string, number>();
      const listingOf = new Map<string, { listingId: string; priceLamports: number; expiresAt: number; seller: string }>();
      if (marketOn) {
        const [sales, active] = await Promise.all([listSales(theme.themeId), listActive(theme.themeId, now)]);
        for (const s of sales.filter((x) => x.status === "COMPLETED")) {
          ownerOf.set(s.assetAddress, s.buyer);
          salesOf.set(s.assetAddress, (salesOf.get(s.assetAddress) ?? 0) + 1);
        }
        for (const a of active) listingOf.set(a.assetAddress, { listingId: a.listingId, priceLamports: a.priceLamports, expiresAt: a.expiresAt, seller: a.seller });
      }

      return NextResponse.json(
        {
          theme: publicTheme(theme, now, items.length),
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
        },
        { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } }
      );
    }
    const themes = (await listThemes()).filter((t) => t.status !== "DRAFT");
    const marketOn = isEnabled("NFT_MARKET");
    const branchesOn = isEnabled("NFT_BRANCHES");
    // Everything below is counted from what PANDA verified: published NFTs, completed sales, opened branches. Null = that feature is off.
    const details = await Promise.all(
      themes.map(async (t) => {
        const items = await listPublished(t.themeId);
        const volumeLamports = marketOn ? (await listSales(t.themeId)).filter((s) => s.status === "COMPLETED").reduce((sum, s) => sum + s.priceLamports, 0) : null;
        const branches = branchesOn ? (await listBranchesOfTheme(t.themeId)).length : null;
        return { nfts: items.length, extra: { creators: new Set(items.map((i) => i.wallet)).size, volumeLamports, branches } };
      })
    );
    return NextResponse.json({ themes: themes.map((t, i) => publicTheme(t, now, details[i].nfts, details[i].extra)) }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load themes." }, { status: 500 });
  }
}
