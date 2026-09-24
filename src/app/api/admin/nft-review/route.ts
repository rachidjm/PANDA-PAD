import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { isEnabled } from "@/lib/config/flags";
import { docListPaths, docRead } from "@/lib/storage/store";
import { getRecord, NftRecord } from "@/lib/nft/store";
import { reviewNft } from "@/lib/nft/service";
import { recordAudit } from "@/lib/audit/log";

/**
 * Auth: admin. Review queue for images that look like an existing one (never auto-decided).
 * GET  -> uploads waiting for review, each with the image it resembles.
 * POST -> { contentId, decision: "approve" | "reject", confirm: "APPROVE NFT <id>" | "REJECT NFT <id>" }.
 * Reject frees the uploader's creation slot and the image. Audited. Gated by NFT_THEMES.
 */
export async function GET(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  try {
    const paths = await docListPaths("nft/records/");
    const records = (await Promise.all(paths.map((p) => docRead<NftRecord | null>(p, null)))).filter(
      (r): r is NftRecord => !!r && r.review === "REVIEW_REQUIRED" && r.status === "UPLOADED"
    );
    const queue = await Promise.all(
      records.map(async (r) => ({
        contentId: r.contentId,
        wallet: r.wallet,
        name: r.name,
        imageUrl: r.imageUrl,
        themeSlug: r.themeSlug,
        distance: r.nearOf?.distance ?? null,
        resembles: r.nearOf ? ((await getRecord(r.nearOf.contentId))?.imageUrl ?? null) : null,
        createdAt: r.createdAt,
      }))
    );
    return NextResponse.json({ queue }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load the review queue." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const b = await req.json().catch(() => null);
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!b || typeof b.contentId !== "string" || (b.decision !== "approve" && b.decision !== "reject")) return bad("Invalid request.");
  if (b.confirm !== `${String(b.decision).toUpperCase()} NFT ${b.contentId}`) return bad(`Confirmation must be exactly "${String(b.decision).toUpperCase()} NFT ${b.contentId}".`);

  try {
    const r = await reviewNft({ contentId: b.contentId, decision: b.decision });
    if (!r.ok) return bad(r.error, r.status);
    await recordAudit({
      req,
      actor: admin.wallet,
      action: `nft.review.${b.decision}`,
      object: `nft:${b.contentId}`,
      newState: { review: r.record.review, status: r.record.status, uploader: r.record.wallet },
    });
    return NextResponse.json({ contentId: r.record.contentId, review: r.record.review, status: r.record.status });
  } catch {
    return bad("The review couldn't be saved — try again.", 500);
  }
}
