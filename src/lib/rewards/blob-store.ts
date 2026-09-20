import { put, get, BlobPreconditionFailedError } from "@vercel/blob";

/**
 * Thin, server-only JSON read/write helpers over Vercel Blob — the real,
 * already-provisioned storage this project uses for image/metadata hosting
 * (src/app/api/upload-metadata/route.ts), reused as bookkeeping for the
 * rewards registry/ledger instead of adding a database.
 *
 * Money-relevant state (the ledger) must never be lost to two writers racing,
 * so reads bypass the CDN cache (`useCache: false`) and every read-modify-write
 * goes through `updateJson`, which uses the blob's ETag as an optimistic lock
 * (`ifMatch`) and retries on conflict.
 */

// Same token-name fallback as upload-metadata/route.ts — Vercel's "connect a
// store" flow doesn't always land on the plain BLOB_READ_WRITE_TOKEN name.
const BLOB_TOKEN =
  process.env.BLOB_READ_WRITE_TOKEN ||
  process.env.BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN ||
  process.env.PANDA_PAD_BLOB_READ_WRITE_TOKEN;

export function blobConfigured(): boolean {
  return !!BLOB_TOKEN;
}

export function requireToken(): string {
  if (!BLOB_TOKEN) throw new Error("Blob storage isn't configured — set BLOB_READ_WRITE_TOKEN.");
  return BLOB_TOKEN;
}

class WriteConflict extends Error {}

async function readWithEtag<T>(path: string, fallback: T): Promise<{ data: T; etag: string | null }> {
  const res = await get(path, { access: "public", useCache: false, token: requireToken() });
  if (!res || res.statusCode !== 200) return { data: fallback, etag: null };
  return { data: (await new Response(res.stream).json()) as T, etag: res.blob.etag };
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  return (await readWithEtag(path, fallback)).data;
}

async function writeIfUnchanged(path: string, data: unknown, etag: string | null): Promise<void> {
  try {
    await put(path, JSON.stringify(data), {
      access: "public",
      addRandomSuffix: false,
      // First write of a path must not silently replace a blob a concurrent
      // writer just created; later writes are guarded by the ETag instead.
      allowOverwrite: etag !== null,
      ...(etag ? { ifMatch: etag } : {}),
      contentType: "application/json",
      // Bookkeeping is always re-read with useCache:false, so browsers/CDNs holding it is pointless.
      cacheControlMaxAge: 60,
      token: requireToken(),
    });
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError || (err instanceof Error && /already exists/i.test(err.message))) {
      throw new WriteConflict();
    }
    throw err;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  requireToken();
  await put(path, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: requireToken(),
  });
}

/**
 * Atomic read-modify-write. `mutate` may run more than once (on conflict it is
 * re-run against the freshly-read value), so it must be a pure function of its
 * input. Returns whatever `mutate` returned on the attempt that was committed.
 */
export async function updateJson<T, R = void>(
  path: string,
  fallback: T,
  mutate: (current: T) => { next: T; result: R }
): Promise<R> {
  const attempts = 10;
  for (let i = 0; i < attempts; i++) {
    const { data, etag } = await readWithEtag<T>(path, fallback);
    const { next, result } = mutate(structuredClone(data));
    try {
      await writeIfUnchanged(path, next, etag);
      return result;
    } catch (err) {
      if (!(err instanceof WriteConflict)) throw err;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
    }
  }
  throw new Error(`Couldn't update ${path}: too many concurrent writers — try again.`);
}
