import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getThemeBySlug, listThemes } from "@/lib/themes/store";
import { displayStatus, Theme } from "@/lib/themes/theme";
import { listPublished } from "@/lib/nft/store";

const publicTheme = (t: Theme, now: number, nfts: number) => ({
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
      return NextResponse.json(
        {
          theme: publicTheme(theme, now, items.length),
          nfts: items.map((i) => ({
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
    const counts = await Promise.all(themes.map(async (t) => (await listPublished(t.themeId)).length));
    return NextResponse.json({ themes: themes.map((t, i) => publicTheme(t, now, counts[i])) }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load themes." }, { status: 500 });
  }
}
