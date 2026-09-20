import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { getSessionWallet } from "@/lib/auth/session";
import { isEnabled } from "@/lib/config/flags";
import { getThemeBySlug } from "@/lib/themes/store";
import { getBranchBySlug } from "@/lib/branches/store";
import { BRANCH_CONFIG } from "@/lib/branches/config";
import { listWalletRecords } from "@/lib/nft/store";

/** Auth: signed-in wallet session — a wallet only sees its own uploads. Query: ?theme=<slug>. Gated by NFT_THEMES. */
export async function GET(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const wallet = getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (rateLimited(`nft-mine:${wallet}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const params = new URL(req.url).searchParams;
  const slug = params.get("theme") ?? "";
  const branchSlug = params.get("branch");
  try {
    let scope: number | string;
    let limit: number;
    if (branchSlug !== null) {
      if (!isEnabled("NFT_BRANCHES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
      const branch = await getBranchBySlug(branchSlug);
      if (!branch) return NextResponse.json({ error: "No such branch." }, { status: 404 });
      scope = `b${branch.branchId}`;
      limit = BRANCH_CONFIG.creationLimitPerWallet;
    } else {
      const theme = await getThemeBySlug(slug);
      if (!theme) return NextResponse.json({ error: "No such theme." }, { status: 404 });
      scope = theme.themeId;
      limit = theme.creationLimit;
    }
    const records = await listWalletRecords(scope, wallet);
    const res = NextResponse.json({
      limit,
      items: records.map((r) => ({
        contentId: r.contentId,
        name: r.name,
        imageUrl: r.imageUrl,
        status: r.status,
        review: r.review,
        asset: r.assetAddress ?? null,
        signature: r.signature ?? null,
        failReason: r.status === "REJECTED_ONCHAIN" || r.status === "REJECTED" ? (r.failReason ?? null) : null,
      })),
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't load your uploads." }, { status: 500 });
  }
}
