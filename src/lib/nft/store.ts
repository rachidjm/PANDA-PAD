import { docRead, docUpdate } from "@/lib/storage/store";
import { classify, DedupeEntry, DedupeIndex, EMPTY_INDEX, markPublished, PENDING_TTL_MS, release, reserve, Verdict } from "./dedupe";

/**
 * Storage for the NFT pipeline (server only). Everything that decides
 * "may this succeed?" is one atomic update on one document, so two racing
 * requests can't both take the last creation slot or both claim the same image.
 */

export type ReviewState = "ORIGINAL" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED";
export type NftStatus = "UPLOADED" | "PREPARED" | "PUBLISHED" | "REJECTED_ONCHAIN" | "REJECTED";

export type NftRecord = {
  contentId: string;
  wallet: string;
  themeId: number;
  themeSlug: string;
  themeTitle: string;
  /** The theme's royalty at upload time — what gets written on-chain and verified back. */
  royaltyBps: number;
  name: string;
  description: string;
  imageUrl: string;
  imageMime: string;
  metadataUri: string;
  width: number;
  height: number;
  pixelHash: string;
  dhash: string;
  /** sha256 of the stored image file — written on-chain as the "Content Hash" attribute. */
  sha256: string;
  originalSha256: string;
  review: ReviewState;
  nearOf?: { contentId: string; distance: number };
  status: NftStatus;
  assetAddress?: string;
  preparedAt?: number;
  signature?: string;
  publishedAt?: number;
  failReason?: string;
  createdAt: number;
  /** Until when an unfinished upload holds its creation slot and its image. */
  expiresAt: number;
};

export type PublishedItem = {
  contentId: string;
  assetAddress: string;
  wallet: string;
  name: string;
  imageUrl: string;
  signature: string;
  publishedAt: number;
  review: ReviewState;
};

const recordPath = (id: string) => `nft/records/${id}.json`;
const slotsPath = (themeId: number, wallet: string) => `nft/by-wallet/${themeId}/${wallet}.json`;
const publishedPath = (themeId: number) => `nft/published/${themeId}.json`;
const DEDUPE_PATH = "nft/dedupe-index.json";

// ---- creation slots (per wallet, per theme) ------------------------------------

type Slot = { contentId: string; status: "pending" | "published"; expiresAt?: number };
type SlotsDoc = { version: 1; items: Slot[] };
const EMPTY_SLOTS: SlotsDoc = { version: 1, items: [] };
const slotAlive = (s: Slot, now: number) => s.status === "published" || (s.expiresAt ?? 0) > now;

/** Takes one of the wallet's creation slots for the theme, or reports the limit. Expired unfinished uploads free their slot. */
export async function reserveSlot(themeId: number, wallet: string, contentId: string, limit: number, now: number): Promise<"ok" | "limit"> {
  return docUpdate<SlotsDoc, "ok" | "limit">(slotsPath(themeId, wallet), EMPTY_SLOTS, (doc) => {
    const live = doc.items.filter((s) => slotAlive(s, now));
    if (live.length >= limit) return { next: { ...doc, items: live }, result: "limit" };
    return { next: { ...doc, items: [...live, { contentId, status: "pending", expiresAt: now + PENDING_TTL_MS }] }, result: "ok" };
  });
}

export async function releaseSlot(themeId: number, wallet: string, contentId: string): Promise<void> {
  await docUpdate<SlotsDoc, void>(slotsPath(themeId, wallet), EMPTY_SLOTS, (doc) => ({
    next: { ...doc, items: doc.items.filter((s) => s.contentId !== contentId) },
    result: undefined,
  }));
}

export async function publishSlot(themeId: number, wallet: string, contentId: string): Promise<void> {
  await docUpdate<SlotsDoc, void>(slotsPath(themeId, wallet), EMPTY_SLOTS, (doc) => ({
    next: { ...doc, items: doc.items.map((s) => (s.contentId === contentId ? { ...s, status: "published" as const, expiresAt: undefined } : s)) },
    result: undefined,
  }));
}

/** Extends a slot's life (a prepared mint that is being signed must not lose its slot mid-flight). */
export async function extendSlot(themeId: number, wallet: string, contentId: string, until: number): Promise<void> {
  await docUpdate<SlotsDoc, void>(slotsPath(themeId, wallet), EMPTY_SLOTS, (doc) => ({
    next: { ...doc, items: doc.items.map((s) => (s.contentId === contentId && s.status === "pending" ? { ...s, expiresAt: Math.max(s.expiresAt ?? 0, until) } : s)) },
    result: undefined,
  }));
}

// ---- duplicate index -----------------------------------------------------------

/** Atomically classifies an image and, unless it's an exact/own copy, reserves it. */
export async function reserveImage(
  hashes: { pixelHash: string; dhash: string },
  entry: DedupeEntry,
  now: number
): Promise<Verdict> {
  return docUpdate<DedupeIndex, Verdict>(DEDUPE_PATH, EMPTY_INDEX, (index) => {
    const verdict = classify(index, hashes, entry.wallet, now);
    if (verdict.kind === "exact" || verdict.kind === "own_pending") return { next: index, result: verdict };
    return { next: reserve(index, entry, now), result: verdict };
  });
}

export async function releaseImage(contentId: string): Promise<void> {
  await docUpdate<DedupeIndex, void>(DEDUPE_PATH, EMPTY_INDEX, (index) => ({ next: release(index, contentId), result: undefined }));
}

export async function publishImage(contentId: string): Promise<void> {
  await docUpdate<DedupeIndex, void>(DEDUPE_PATH, EMPTY_INDEX, (index) => ({ next: markPublished(index, contentId), result: undefined }));
}

// ---- records -----------------------------------------------------------------

export async function getRecord(contentId: string): Promise<NftRecord | null> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(contentId)) return null;
  return docRead<NftRecord | null>(recordPath(contentId), null);
}

export async function saveRecord(rec: NftRecord): Promise<void> {
  await docUpdate<NftRecord | null, void>(recordPath(rec.contentId), null, () => ({ next: rec, result: undefined }));
}

/** Atomic read-modify-write of one record; `mutate` returns the new record (or the same one for "no change") and a result. */
export async function updateRecord<R>(
  contentId: string,
  mutate: (rec: NftRecord | null) => { next: NftRecord | null; result: R }
): Promise<R> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(contentId)) throw new Error("Bad content id.");
  return docUpdate<NftRecord | null, R>(recordPath(contentId), null, mutate);
}

// ---- published list ------------------------------------------------------------

type PublishedDoc = { version: 1; items: PublishedItem[] };

export async function appendPublished(themeId: number, item: PublishedItem): Promise<void> {
  await docUpdate<PublishedDoc, void>(publishedPath(themeId), { version: 1, items: [] }, (doc) => ({
    next: doc.items.some((i) => i.contentId === item.contentId) ? doc : { ...doc, items: [...doc.items, item] },
    result: undefined,
  }));
}

export async function listPublished(themeId: number): Promise<PublishedItem[]> {
  return (await docRead<PublishedDoc>(publishedPath(themeId), { version: 1, items: [] })).items;
}

// ---- a wallet's own uploads ---------------------------------------------------

/** The records a wallet has in a theme (pending, prepared or published), newest first. */
export async function listWalletRecords(themeId: number, wallet: string): Promise<NftRecord[]> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return [];
  const slots = await docRead<SlotsDoc>(slotsPath(themeId, wallet), EMPTY_SLOTS);
  const records = await Promise.all(slots.items.map((s) => getRecord(s.contentId)));
  return records.filter((r): r is NftRecord => r !== null).sort((a, b) => b.createdAt - a.createdAt);
}
