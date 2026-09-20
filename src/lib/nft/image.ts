import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";

/**
 * The upload pipeline for NFT artwork (server only). Untrusted bytes in;
 * either a clear rejection, or a re-encoded, metadata-free image plus the
 * fingerprints used to detect copies.
 *
 * What it guarantees:
 *  - the file TYPE is decided from its real leading bytes, never from the
 *    filename or the claimed MIME type; SVG/HTML/anything else is refused
 *    (SVG can carry scripts, so it isn't supported at all in this version);
 *  - size, dimensions and decoded pixel count are capped before any heavy
 *    decoding, and libvips is given a hard pixel limit (decompression bombs);
 *  - the output is a fresh encode of the pixels: EXIF/GPS/ICC/text chunks and
 *    any appended payload are dropped, and the image is bounded to 2048 px;
 *  - animated images are refused (static artwork only).
 */

export const IMAGE_LIMITS = {
  // Vercel functions reject request bodies over 4.5 MB, so the file (plus form overhead) has to fit under that.
  maxBytes: 4 * 1024 * 1024,
  minSide: 256,
  maxSide: 8000,
  maxInputPixels: 40_000_000,
  outputMaxSide: 2048,
} as const;

export type ImageKind = "png" | "jpeg" | "gif" | "webp";

export class ImageRejected extends Error {
  constructor(public code: "TOO_LARGE" | "EMPTY" | "UNSUPPORTED_TYPE" | "CORRUPT" | "BAD_DIMENSIONS" | "ANIMATED" | "MISMATCH", message: string) {
    super(message);
  }
}

/** Decides the type from the file's own leading bytes. Null for anything that isn't one of the four raster formats. */
export function sniffImageKind(b: Uint8Array): ImageKind | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (b.length >= 6 && at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

export type ProcessedImage = {
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
  width: number;
  height: number;
  /** sha256 of the original upload, exactly as received. */
  originalSha256: string;
  /** sha256 of the normalized bytes. */
  sha256: string;
  /** sha256 of the decoded pixels (+ size): identical artwork re-saved in another format or with other metadata still collides. */
  pixelHash: string;
  /** 64-bit difference hash as 16 hex chars — near-duplicates land within a few bits of each other. */
  dhash: string;
};

const hex = (buf: Uint8Array | Buffer) => createHash("sha256").update(buf).digest("hex");

export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageRejected("EMPTY", "The file is empty.");
  if (input.length > IMAGE_LIMITS.maxBytes) throw new ImageRejected("TOO_LARGE", "The image is larger than 4 MB.");
  const kind = sniffImageKind(input);
  if (!kind) throw new ImageRejected("UNSUPPORTED_TYPE", "Only PNG, JPEG, GIF and WebP images are accepted.");

  const source = Buffer.from(input);
  const open = () => sharp(source, { limitInputPixels: IMAGE_LIMITS.maxInputPixels, failOn: "error" });

  let meta: Metadata;
  try {
    meta = await open().metadata();
  } catch {
    throw new ImageRejected("CORRUPT", "The image is corrupt or too large to process.");
  }
  if (meta.format !== kind) throw new ImageRejected("MISMATCH", "The file's content doesn't match its type.");
  if ((meta.pages ?? 1) > 1) throw new ImageRejected("ANIMATED", "Animated images aren't supported — upload a still image.");

  const orientedSwap = (meta.orientation ?? 1) >= 5;
  const w = (orientedSwap ? meta.height : meta.width) ?? 0;
  const h = (orientedSwap ? meta.width : meta.height) ?? 0;
  if (w < IMAGE_LIMITS.minSide || h < IMAGE_LIMITS.minSide || w > IMAGE_LIMITS.maxSide || h > IMAGE_LIMITS.maxSide) {
    throw new ImageRejected("BAD_DIMENSIONS", `Images must be between ${IMAGE_LIMITS.minSide} and ${IMAGE_LIMITS.maxSide} px on each side.`);
  }

  let bytes: Buffer;
  let mime: ProcessedImage["mime"];
  try {
    // A fresh encode: rotate() applies EXIF orientation, and sharp writes no metadata unless asked.
    const pipeline = open().rotate().resize({ width: IMAGE_LIMITS.outputMaxSide, height: IMAGE_LIMITS.outputMaxSide, fit: "inside", withoutEnlargement: true });
    if (kind === "jpeg") {
      bytes = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      mime = "image/jpeg";
    } else {
      bytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      mime = "image/png";
    }
  } catch {
    throw new ImageRejected("CORRUPT", "The image couldn't be processed.");
  }

  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelHash = createHash("sha256")
    .update(`${raw.info.width}x${raw.info.height}:`)
    .update(raw.data)
    .digest("hex");

  return {
    bytes,
    mime,
    ext: mime === "image/jpeg" ? "jpg" : "png",
    width: raw.info.width,
    height: raw.info.height,
    originalSha256: hex(source),
    sha256: hex(bytes),
    pixelHash,
    dhash: await differenceHash(bytes),
  };
}

/** 64-bit dHash: 9x8 greyscale, one bit per left<right comparison. Robust to resizing and re-compression. */
export async function differenceHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image)
    .flatten({ background: "#ffffff" }) // transparent areas count as white, deterministically
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = BigInt(0);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << BigInt(1)) | (data[y * 9 + x] < data[y * 9 + x + 1] ? BigInt(1) : BigInt(0));
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** Number of differing bits between two 16-hex-char hashes (0–64). Throws on malformed input. */
export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) throw new Error("Malformed perceptual hash.");
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x > BigInt(0)) {
    n += Number(x & BigInt(1));
    x >>= BigInt(1);
  }
  return n;
}
