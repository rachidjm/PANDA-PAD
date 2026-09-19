import { put, list } from "@vercel/blob";

/**
 * Thin, server-only JSON read/write helpers over Vercel Blob — the real,
 * already-provisioned storage this project uses for image/metadata hosting
 * (src/app/api/upload-metadata/route.ts), reused here as lightweight
 * bookkeeping for the rewards registry/ledger instead of adding a new
 * database dependency. Not a transactional store: a read-modify-write here
 * isn't atomic, so concurrent writers to the same path could race — an
 * accepted, disclosed MVP limitation at PANDA's current scale, not something
 * hidden from future maintainers.
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

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!BLOB_TOKEN) throw new Error("Blob storage isn't configured — set BLOB_READ_WRITE_TOKEN.");
  const { blobs } = await list({ prefix: path, limit: 1, token: BLOB_TOKEN });
  const match = blobs.find((b) => b.pathname === path);
  if (!match) return fallback;
  const res = await fetch(match.url, { cache: "no-store" });
  if (!res.ok) return fallback;
  return (await res.json()) as T;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  if (!BLOB_TOKEN) throw new Error("Blob storage isn't configured — set BLOB_READ_WRITE_TOKEN.");
  await put(path, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: BLOB_TOKEN,
  });
}
