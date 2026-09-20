import { list, put } from "@vercel/blob";
import { blobConfigured, readJson, requireToken, updateJson } from "@/lib/rewards/blob-store";

/**
 * The one storage interface the points/epoch system talks to: read, atomic
 * read-modify-write, create-once, and list-by-prefix. Today it's Vercel Blob
 * (ETag-guarded updates); when the ledger moves to a real database, this file
 * is what gets replaced. Local development without a Blob store uses memory;
 * production without one fails (no silent fallback).
 */

const memory = new Map<string, unknown>();
const inMemory = () => process.env.NODE_ENV !== "production" && !blobConfigured();

export async function docRead<T>(path: string, fallback: T): Promise<T> {
  if (inMemory()) return structuredClone((memory.get(path) as T | undefined) ?? fallback);
  return readJson<T>(path, fallback);
}

/** Atomic; `mutate` may run more than once and must be pure (see blob-store's updateJson). */
export async function docUpdate<T, R>(path: string, fallback: T, mutate: (current: T) => { next: T; result: R }): Promise<R> {
  if (inMemory()) {
    const { next, result } = mutate(structuredClone((memory.get(path) as T | undefined) ?? fallback));
    memory.set(path, structuredClone(next));
    return result;
  }
  return updateJson<T, R>(path, fallback, mutate);
}

/** Writes only if nothing exists at `path`. Returns false (and writes nothing) if it already does. */
export async function docPutOnce(path: string, data: unknown): Promise<boolean> {
  if (inMemory()) {
    if (memory.has(path)) return false;
    memory.set(path, structuredClone(data));
    return true;
  }
  try {
    await put(path, JSON.stringify(data), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
      token: requireToken(),
    });
    return true;
  } catch (err) {
    if (err instanceof Error && /already exists/i.test(err.message)) return false;
    throw err;
  }
}

/** Paths under `prefix`, sorted. Throws rather than returning a partial list if there are more than `max`. */
export async function docListPaths(prefix: string, max = 5000): Promise<string[]> {
  if (inMemory()) return [...memory.keys()].filter((k) => k.startsWith(prefix)).sort();
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, cursor, token: requireToken() });
    paths.push(...page.blobs.map((b) => b.pathname));
    if (paths.length > max) throw new Error(`More than ${max} documents under ${prefix} — refusing to work with a partial list.`);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths.sort();
}
