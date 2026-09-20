import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { isEnabled } from "@/lib/config/flags";
import { realNftDeps, siteUrlFor } from "@/lib/nft/deps";
import { confirmMint } from "@/lib/nft/service";

/**
 * Auth: signed-in wallet session; the upload must belong to that wallet.
 * Body: { contentId, signature? } — the signature is optional (someone who closed the tab has none);
 * without it the asset is verified straight from the chain. Publishes ONLY after the transaction is confirmed and the
 * asset read back from the chain matches exactly what PANDA specified. 202 = not confirmed or
 * not visible yet (safe to call again); an asset that doesn't match is never published.
 * Deliberately NOT blocked by the minting pause: mints already in flight must be able to finish.
 * Gated by NFT_THEMES.
 */
export async function POST(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });

  const wallet = getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (rateLimited(`nft-confirm:${wallet}`, 40, 60_000)) return NextResponse.json({ error: "Too many attempts — wait a moment.", code: "RATE_LIMITED" }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.contentId !== "string") return NextResponse.json({ error: "Invalid request.", code: "BAD_REQUEST" }, { status: 400 });

  try {
    const r = await confirmMint(realNftDeps(siteUrlFor(req)), { wallet, contentId: body.contentId, signature: body.signature });
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json({
      status: "PUBLISHED",
      asset: r.record.assetAddress,
      signature: r.record.signature ?? null,
      alreadyPublished: r.alreadyPublished,
    });
  } catch (err) {
    console.error("[PANDA] nft confirm failed", String(err));
    return NextResponse.json({ error: "Couldn't check the mint — nothing is lost; try again shortly.", code: "ERROR" }, { status: 500 });
  }
}
