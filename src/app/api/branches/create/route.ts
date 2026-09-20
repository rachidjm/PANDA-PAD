import { NextResponse } from "next/server";
import { pausedResponse } from "@/lib/protocol/guard";
import { recordAudit } from "@/lib/audit/log";
import { branchGate } from "@/lib/branches/route";
import { realBranchDeps } from "@/lib/branches/deps";
import { createBranch } from "@/lib/branches/service";
import { publicBranch } from "@/lib/branches/view";

/**
 * Auth: signed-in wallet session; the creator is the session's wallet, never a field. Body: { themeSlug, title, description }.
 * Eligibility is recomputed here from the market's verified sales — the client can't claim it. Gated by NFT_THEMES +
 * NFT_BRANCHES and the `nft_minting` pause switch. Audited.
 */
export async function POST(req: Request) {
  const gate = branchGate(req, "create", 5);
  if (gate instanceof NextResponse) return gate;
  const paused = await pausedResponse("nft_minting");
  if (paused) return paused;

  const b = await req.json().catch(() => null);
  if (!b || typeof b.themeSlug !== "string") return NextResponse.json({ error: "Missing theme." }, { status: 400 });
  try {
    const r = await createBranch(realBranchDeps(), { wallet: gate.wallet, themeSlug: b.themeSlug, title: b.title, description: b.description });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, code: r.code, ...(r.eligibility ? { criteria: r.eligibility.criteria, excluded: r.eligibility.excluded } : {}) },
        { status: r.status }
      );
    }
    await recordAudit({ req, actor: gate.wallet, action: "branch.create", object: `branch:${r.branch.branchId}`, newState: { theme: r.branch.themeSlug, title: r.branch.title, eligibility: r.branch.eligibility } });
    return NextResponse.json({ branch: publicBranch(r.branch, 0) });
  } catch (err) {
    console.error("[PANDA] branch create failed", String(err));
    return NextResponse.json({ error: "Couldn't open the branch — try again." }, { status: 500 });
  }
}
