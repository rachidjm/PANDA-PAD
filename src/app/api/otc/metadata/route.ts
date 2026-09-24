import { NextResponse } from "next/server";
import { coinCreationGuardResponse } from "@/lib/config/launch-guard";
import { featureDisabledResponse } from "@/lib/config/guard";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { pausedResponse } from "@/lib/protocol/guard";
import { recordAudit } from "@/lib/audit/log";
import { uploadMetadata, OtcApiError } from "@/lib/otc/client";
import { createOtcLaunch, getOtcLaunch } from "@/lib/otc/store";
import { validateOtcLaunchFields } from "@/lib/otc/validate";

const ACCEPTED_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];

/**
 * Step 1 of a PANDA Rewards (OTC) launch: pins the coin's image + metadata via OTC's real
 * POST /api/ipfs (see src/lib/otc/client.ts), and creates PANDA's own launch record for this mint
 * (src/lib/otc/store.ts) — the record that makes "don't start a second launch for a mint that
 * already has one" a real check, not a client-side promise.
 */
export async function POST(req: Request) {
  const disabled = featureDisabledResponse("OTC_REWARDS");
  if (disabled) return disabled;
  const creationBlocked = coinCreationGuardResponse();
  if (creationBlocked) return creationBlocked;
  const paused = await pausedResponse("token_launches");
  if (paused) return paused;
  {
    // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
    const limited = await moneyRateGate(`otc-metadata:${clientIp(req)}`, 10, 60_000, () => NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 }));
    if (limited) return limited;
  }

  try {
    const form = await req.formData();
    const image = form.get("image");
    const mint = String(form.get("mint") || "");
    const creator = String(form.get("creator") || "");
    const name = String(form.get("name") || "").trim();
    const symbol = String(form.get("symbol") || "").trim();
    const description = String(form.get("description") || "").slice(0, 500);
    const quoteMint = String(form.get("quoteMint") || "");
    const mode = form.get("mode") ? String(form.get("mode")) : undefined;
    const buy = form.get("buy") ? String(form.get("buy")) : undefined;
    const website = form.get("website") ? String(form.get("website")) : undefined;
    const twitter = form.get("twitter") ? String(form.get("twitter")) : undefined;
    const telegram = form.get("telegram") ? String(form.get("telegram")) : undefined;

    if (!(image instanceof File)) return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    if (!ACCEPTED_TYPES.includes(image.type)) return NextResponse.json({ error: "Image must be GIF, PNG, JPG or WEBP." }, { status: 400 });

    const fieldError = validateOtcLaunchFields({ mint, name, symbol, uri: "placeholder", creator, quoteMint, mode, buy });
    if (fieldError) return NextResponse.json({ error: fieldError }, { status: 400 });

    const existing = await getOtcLaunch(mint);
    if (existing) {
      return NextResponse.json(
        { error: "A launch already exists for this mint.", code: "ALREADY_EXISTS", launch: existing },
        { status: 409 }
      );
    }

    const { metadataUri } = await uploadMetadata({
      file: image,
      filename: image.name || "coin.png",
      name,
      symbol,
      description,
      twitter,
      telegram,
      website,
    });

    const record = await createOtcLaunch(
      { mint, creator, name, symbol, uri: metadataUri, quoteMint, mode: (mode as "low" | "high") ?? "low", buy: buy ?? "0" },
      "METADATA_CREATED",
      Date.now()
    );
    if (!record) {
      // Lost a race with a concurrent identical request — not an error the user needs to see differently.
      return NextResponse.json({ error: "A launch already exists for this mint.", code: "ALREADY_EXISTS" }, { status: 409 });
    }

    await recordAudit({
      req,
      actor: `unauthenticated:${creator}`,
      action: "otc.metadata_uploaded",
      object: mint,
      newState: { symbol, quoteMint },
    });

    return NextResponse.json({ metadataUri, launch: record });
  } catch (err) {
    if (err instanceof OtcApiError) return NextResponse.json({ error: err.message }, { status: err.status === 400 ? 400 : 502 });
    const message = err instanceof Error ? err.message : "Failed to upload metadata.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
