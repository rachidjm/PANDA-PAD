import { put, get, list, BlobPreconditionFailedError } from "@vercel/blob";

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

// Local development and tests without a Blob store only (production without one still fails closed, see requireToken).
const memory = new Map<string, unknown>();
const inMemory = () => process.env.NODE_ENV !== "production" && !BLOB_TOKEN;

async function readWithEtag<T>(path: string, fallback: T): Promise<{ data: T; etag: string | null }> {
  const res = await get(path, { access: "public", useCache: false, token: requireToken() });
  if (!res || res.statusCode !== 200) return { data: fallback, etag: null };
  return { data: (await new Response(res.stream).json()) as T, etag: res.blob.etag };
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (inMemory()) return structuredClone((memory.get(path) as T | undefined) ?? fallback);
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
  if (inMemory()) {
    memory.set(path, structuredClone(data));
    return;
  }
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
  if (inMemory()) {
    const { next, result } = mutate(structuredClone((memory.get(path) as T | undefined) ?? fallback));
    memory.set(path, structuredClone(next));
    return result;
  }
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

/** Paths under `prefix`, sorted (for the Postgres migration tools). Throws rather than returning a partial list if there are more than `max`. */
export async function listPaths(prefix: string, max = 20_000): Promise<string[]> {
  if (inMemory()) return [...memory.keys()].filter((k) => k.startsWith(prefix)).sort();
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, cursor, token: requireToken() });
    for (const b of page.blobs) paths.push(b.pathname);
    if (paths.length > max) throw new Error(`More than ${max} blobs under ${prefix}.`);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths.sort();
}
