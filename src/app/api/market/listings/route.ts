import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getThemeBySlug } from "@/lib/themes/store";
import { MARKET_CONFIG } from "@/lib/market/config";
import { getListing, listActive, listSales } from "@/lib/market/store";
import { marketStats } from "@/lib/market/service";

/**
 * Auth: none (public). Query: ?theme=<slug>. REAL data only: what can be bought right now, the
 * latest verified sales, and stats derived from those sales — nothing simulated. Gated by NFT_MARKET.
 */
export async function GET(req: Request) {
  if (!isEnabled("NFT_MARKET")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const slug = new URL(req.url).searchParams.get("theme") ?? "";
  const now = Date.now();
  try {
    const theme = await getThemeBySlug(slug);
    if (!theme || theme.status === "DRAFT") return NextResponse.json({ error: "No such theme." }, { status: 404 });

    const [active, sales, stats] = await Promise.all([listActive(theme.themeId, now), listSales(theme.themeId), marketStats(theme.themeId, now)]);
    const listings = (await Promise.all(active.map((a) => getListing(a.listingId)))).filter((l) => l && l.status === "ACTIVE");

    return NextResponse.json(
      {
        feeBps: MARKET_CONFIG.feeBps,
        secondaryEnabled: isEnabled("NFT_SECONDARY"),
        stats,
        listings: listings.map((l) => ({
          listingId: l!.listingId,
          asset: l!.assetAddress,
          contentId: l!.contentId,
          name: l!.name,
          imageUrl: l!.imageUrl,
          seller: l!.seller,
          priceLamports: l!.priceLamports,
          expiresAt: l!.expiresAt,
        })),
        sales: sales
          .filter((s) => s.status === "COMPLETED")
          .slice(-20)
          .reverse()
          .map((s) => ({ asset: s.assetAddress, buyer: s.buyer, seller: s.seller, kind: s.kind, priceLamports: s.priceLamports, signature: s.signature ?? null, completedAt: s.completedAt ?? null })),
      },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't load the market." }, { status: 500 });
  }
}
