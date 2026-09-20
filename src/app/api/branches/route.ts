import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getThemeBySlug } from "@/lib/themes/store";
import { displayStatus } from "@/lib/themes/theme";
import { listBranchPublished } from "@/lib/nft/store";
import { getBranchBySlug, listBranchesOfTheme } from "@/lib/branches/store";
import { branchesEnabled, notAvailable } from "@/lib/branches/route";
import { branchNftViews, publicBranch } from "@/lib/branches/view";
import { BRANCH_CONFIG } from "@/lib/branches/config";

const CACHE = { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" };

/**
 * Public. Gated by NFT_THEMES + NFT_BRANCHES.
 *   ?theme=<slug>   the branches of a theme
 *   ?slug=<slug>    one branch, its theme's basic facts and its chain-verified NFTs (with market data when the market is on)
 * `rules` is what the UI shows creators about limits and eligibility (the methodology is public).
 */
export async function GET(req: Request) {
  if (!branchesEnabled()) return notAvailable();
  if (rateLimited(`branches:ip:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const params = new URL(req.url).searchParams;
  const now = Date.now();
  const rules = { ...BRANCH_CONFIG };

  try {
    const slug = params.get("slug");
    if (slug !== null) {
      const branch = await getBranchBySlug(slug);
      if (!branch) return NextResponse.json({ error: "No such branch." }, { status: 404 });
      const theme = await getThemeBySlug(branch.themeSlug);
      const { market, nfts } = await branchNftViews(branch, now);
      return NextResponse.json(
        {
          branch: publicBranch(branch, nfts.length),
          theme: theme ? { slug: theme.slug, title: theme.title, status: displayStatus(theme, now), royaltyBps: theme.royaltyBps } : null,
          market,
          nfts,
          rules,
        },
        { headers: CACHE }
      );
    }

    const themeSlug = params.get("theme");
    if (themeSlug === null) return NextResponse.json({ error: "Pass ?theme=<slug> or ?slug=<slug>." }, { status: 400 });
    const theme = await getThemeBySlug(themeSlug);
    if (!theme || theme.status === "DRAFT") return NextResponse.json({ error: "No such theme." }, { status: 404 });
    const branches = await listBranchesOfTheme(theme.themeId);
    const counts = await Promise.all(branches.map(async (b) => (await listBranchPublished(b.branchId)).length));
    return NextResponse.json({ branches: branches.map((b, i) => publicBranch(b, counts[i])), rules }, { headers: CACHE });
  } catch {
    return NextResponse.json({ error: "Couldn't load branches." }, { status: 500 });
  }
}
