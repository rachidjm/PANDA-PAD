import sharp from "sharp";

const HASH_W = 9; // one extra column than HASH_H: each row compares 8 adjacent pixel pairs
const HASH_H = 8;

/**
 * Difference hash (dHash): for each row, compares each pixel to its right neighbor ("1" if
 * darker→lighter, else "0"). Robust to resizing/recompression (the usual way a cloned logo
 * gets re-uploaded), not to real design differences — that's what hammingDistance's threshold
 * is for. `pixels` must be HASH_W*HASH_H grayscale bytes, row-major (exactly what sharp's
 * `.grayscale().resize(HASH_W, HASH_H, { fit: "fill" }).raw()` produces).
 */
export function dHashFromGrayscale(pixels: Uint8Array | number[]): string {
  if (pixels.length !== HASH_W * HASH_H) throw new Error(`dHashFromGrayscale expects ${HASH_W * HASH_H} pixels, got ${pixels.length}`);
  let bits = "";
  for (let row = 0; row < HASH_H; row++) {
    for (let col = 0; col < HASH_H; col++) {
      const left = pixels[row * HASH_W + col];
      const right = pixels[row * HASH_W + col + 1];
      bits += left < right ? "1" : "0";
    }
  }
  return bits;
}

/** Number of differing bits between two same-length dHashes (0 = identical, 64 = maximally different). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const cache = new Map<string, string | null>();

/** Fetches and hashes one image, real I/O — best-effort: any failure (network, non-image, decode
 *  error, timeout) returns null rather than throwing, so one bad URL never blocks the rest of the
 *  list. Cached per URL for the life of the process, since the same logos recur across refreshes. */
export async function perceptualHashUrl(url: string, timeoutMs = 4000): Promise<string | null> {
  if (cache.has(url)) return cache.get(url)!;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    const { data } = await sharp(buf).grayscale().resize(HASH_W, HASH_H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    const hash = dHashFromGrayscale(data);
    cache.set(url, hash);
    return hash;
  } catch {
    cache.set(url, null);
    return null;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight at once — a handful of image fetches per
 *  refresh is fine, sixty all at once against arbitrary third-party hosts is not. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
