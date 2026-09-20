/**
 * NFT metadata: user text is sanitized and bounded, and the JSON is built in a
 * fixed key order so the same inputs always produce the same bytes (and the
 * same hash). Nothing sensitive goes in: no IPs, no emails, no session data.
 * The JSON follows the common Metaplex/Solana metadata layout so wallets and
 * marketplaces can display it.
 */

const CONTROL = /[\u0000-\u001f\u007f]/g;
const ANGLE = /[<>]/g;

/** Strips control characters and angle brackets, collapses whitespace, trims. */
export function cleanText(s: string): string {
  return s.replace(CONTROL, " ").replace(ANGLE, "").replace(/\s+/g, " ").trim();
}

export const LIMITS = { name: 32, description: 500 } as const;

export type MetadataInput = { name: unknown; description: unknown };

/** Returns the cleaned fields, or an error message. */
export function validateTexts(input: MetadataInput): { ok: true; name: string; description: string } | { ok: false; error: string } {
  if (typeof input.name !== "string" || typeof input.description !== "string") return { ok: false, error: "Name and description are required." };
  const name = cleanText(input.name);
  const description = cleanText(input.description);
  if (name.length < 2 || name.length > LIMITS.name) return { ok: false, error: `Name must be 2–${LIMITS.name} characters.` };
  if (description.length > LIMITS.description) return { ok: false, error: `Description can be at most ${LIMITS.description} characters.` };
  return { ok: true, name, description };
}

export type NftMetadata = {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: { trait_type: string; value: string }[];
  properties: {
    category: "image";
    files: { uri: string; type: string }[];
    creators: { address: string; share: number }[];
  };
};

export function buildMetadata(args: {
  name: string;
  description: string;
  imageUrl: string;
  imageMime: string;
  siteUrl: string;
  creator: string;
  theme: { slug: string; title: string; themeId: number };
  contentHash: string;
  branch?: { slug: string; title: string; branchId: number };
}): NftMetadata {
  const { name, description, imageUrl, imageMime, siteUrl, creator, theme, contentHash, branch } = args;
  return {
    name,
    description,
    image: imageUrl,
    external_url: branch ? `${siteUrl.replace(/\/$/, "")}/branches/${branch.slug}` : `${siteUrl.replace(/\/$/, "")}/themes/${theme.slug}`,
    attributes: [
      { trait_type: "Theme", value: theme.title },
      { trait_type: "Theme ID", value: String(theme.themeId) },
      { trait_type: "Content Hash", value: contentHash },
      ...(branch ? [{ trait_type: "Branch", value: branch.title }, { trait_type: "Branch ID", value: String(branch.branchId) }] : []),
    ],
    properties: {
      category: "image",
      files: [{ uri: imageUrl, type: imageMime }],
      creators: [{ address: creator, share: 100 }],
    },
  };
}
