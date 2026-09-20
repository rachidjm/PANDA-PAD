import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { isEnabled } from "@/lib/config/flags";
import { pausedResponse } from "@/lib/protocol/guard";
import { realNftDeps, siteUrlFor } from "@/lib/nft/deps";
import { uploadNft } from "@/lib/nft/service";
import { IMAGE_LIMITS } from "@/lib/nft/image";

export const maxDuration = 30;

// The platform itself rejects bodies over 4.5 MB; refuse early and clearly rather than read a huge stream.
const MAX_BODY = IMAGE_LIMITS.maxBytes + 256 * 1024;

/**
 * Auth: signed-in wallet session (the creator is the session's wallet, never a field).
 * Body: multipart/form-data { themeSlug | branchSlug, name, description, image } — for a branch the NFT is named
 * ("Title #001") and numbered by the server, so `name` is ignored, and only the creator / listed contributors may add.
 * Effect: validates the theme is open, the text, and the image (real file type, size,
 * dimensions, metadata stripped), takes one of the wallet's creation slots, checks for
 * duplicates, and stores the cleaned image and its metadata. Nothing is minted here.
 * Gated by NFT_THEMES and the `nft_minting` pause switch. Rate limited per wallet and IP.
 */
export async function POST(req: Request) {
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const paused = await pausedResponse("nft_minting");
  if (paused) return paused;

  const wallet = getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (rateLimited(`nft-upload:ip:${clientIp(req)}`, 30, 60_000) || rateLimited(`nft-upload:wallet:${wallet}`, 8, 60_000)) {
    return NextResponse.json({ error: "Too many uploads — wait a minute.", code: "RATE_LIMITED" }, { status: 429 });
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return NextResponse.json({ error: "The image is too large (max 4 MB).", code: "BAD_IMAGE" }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload.", code: "BAD_REQUEST" }, { status: 400 });
  }
  const file = form.get("image");
  const themeSlug = form.get("themeSlug");
  const branchSlug = form.get("branchSlug");
  const inBranch = typeof branchSlug === "string";
  if (inBranch && !isEnabled("NFT_BRANCHES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!(file instanceof File) || (!inBranch && typeof themeSlug !== "string")) return NextResponse.json({ error: "Missing image or theme.", code: "BAD_REQUEST" }, { status: 400 });
  if (file.size > IMAGE_LIMITS.maxBytes) return NextResponse.json({ error: "The image is too large (max 4 MB).", code: "BAD_IMAGE" }, { status: 413 });

  try {
    const result = await uploadNft(realNftDeps(siteUrlFor(req)), {
      wallet,
      ...(inBranch ? { branchSlug } : { themeSlug: themeSlug as string }),
      name: form.get("name"),
      description: form.get("description") ?? "",
      file: new Uint8Array(await file.arrayBuffer()),
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    const r = result.record;
    return NextResponse.json({
      contentId: r.contentId,
      status: r.status,
      review: r.review, // ORIGINAL, or REVIEW_REQUIRED when the image resembles an existing one
      resumed: result.resumed,
      name: r.name,
      imageUrl: r.imageUrl,
      width: r.width,
      height: r.height,
      royaltyBps: r.royaltyBps,
    });
  } catch (err) {
    console.error("[PANDA] nft upload failed", String(err));
    return NextResponse.json({ error: "The upload couldn't be completed — try again.", code: "ERROR" }, { status: 500 });
  }
}
