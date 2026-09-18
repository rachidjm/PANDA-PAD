import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

/**
 * Uploads a coin's image + Metaplex-style off-chain metadata JSON to Vercel
 * Blob and returns the metadata URI that Pump.fun's create_v2 instruction
 * expects. Pump.fun doesn't publish an official upload endpoint — create_v2
 * just takes any URI — so this is PANDA's own hosting, picked because it
 * needs no new third-party account (it's already part of the Vercel project).
 */

// Vercel's "connect a store" flow names the token after whatever prefix you
// gave the store, which isn't always the plain BLOB_READ_WRITE_TOKEN the SDK
// looks for by default (e.g. it can come out as
// BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN) — try the common variants instead
// of forcing a rename in the Vercel dashboard.
const BLOB_TOKEN =
  process.env.BLOB_READ_WRITE_TOKEN ||
  process.env.BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN ||
  process.env.PANDA_PAD_BLOB_READ_WRITE_TOKEN;

export async function POST(req: Request) {
  if (!BLOB_TOKEN) {
    return NextResponse.json(
      { error: "Image hosting isn't configured yet — enable Vercel Blob for this project (Storage tab → Create → Blob)." },
      { status: 503 }
    );
  }

  try {
    const form = await req.formData();
    const image = form.get("image");
    const name = String(form.get("name") || "").slice(0, 32);
    const symbol = String(form.get("symbol") || "").slice(0, 10);
    const description = String(form.get("description") || "").slice(0, 500);
    const website = form.get("website") ? String(form.get("website")) : undefined;
    const twitter = form.get("twitter") ? String(form.get("twitter")) : undefined;
    const telegram = form.get("telegram") ? String(form.get("telegram")) : undefined;

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }
    if (!name || !symbol) {
      return NextResponse.json({ error: "Missing name or symbol." }, { status: 400 });
    }

    const imageBlob = await put(`panda/${Date.now()}-${image.name}`, image, {
      access: "public",
      contentType: image.type,
      token: BLOB_TOKEN,
    });

    const metadata = {
      name,
      symbol,
      description,
      image: imageBlob.url,
      showName: true,
      createdOn: "https://pump.fun",
      ...(website && { website }),
      ...(twitter && { twitter }),
      ...(telegram && { telegram }),
    };

    const metadataBlob = await put(`panda/${Date.now()}-metadata.json`, JSON.stringify(metadata), {
      access: "public",
      contentType: "application/json",
      token: BLOB_TOKEN,
    });

    return NextResponse.json({ uri: metadataBlob.url, imageUrl: imageBlob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
