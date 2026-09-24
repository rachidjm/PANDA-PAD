import { NextResponse } from "next/server";
import { branchGate } from "@/lib/branches/route";
import { realBranchDeps } from "@/lib/branches/deps";
import { checkEligibility } from "@/lib/branches/service";
import { BRANCH_CONFIG } from "@/lib/branches/config";

/**
 * Auth: signed-in wallet session — it shows the SESSION wallet's own standing, nobody else's.
 * Query: ?theme=<slug>. Returns each criterion with what is required and what the wallet has, and how many
 * sales didn't count and why, so the methodology is visible. Gated by NFT_THEMES + NFT_BRANCHES.
 */
export async function GET(req: Request) {
  const gate = await branchGate(req, "eligibility", 30);
  if (gate instanceof NextResponse) return gate;
  const themeSlug = new URL(req.url).searchParams.get("theme");
  if (!themeSlug) return NextResponse.json({ error: "Pass ?theme=<slug>." }, { status: 400 });
  try {
    const r = await checkEligibility(realBranchDeps(), { wallet: gate.wallet, themeSlug });
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    const res = NextResponse.json({
      eligible: r.eligibility.eligible,
      criteria: r.eligibility.criteria,
      excluded: r.eligibility.excluded,
      uniqueBuyers: r.eligibility.uniqueBuyers,
      volumeLamports: r.eligibility.volumeLamports,
      minHoldHours: Math.round(BRANCH_CONFIG.eligibility.minHoldMs / 3_600_000),
      configVersion: r.eligibility.configVersion,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't check your eligibility." }, { status: 500 });
  }
}
