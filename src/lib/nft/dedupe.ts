import { hammingDistance } from "./image";

/**
 * Copy detection over everything already uploaded. Pure functions over an
 * index; the store applies them atomically so two simultaneous uploads of the
 * same image can't both win.
 *
 *  - exact   : same decoded pixels -> REJECT (spec: exact duplicates are refused);
 *  - near    : perceptual hashes within NEAR_THRESHOLD bits -> REVIEW REQUIRED
 *              (a resized / re-compressed / lightly edited copy — flagged for a
 *              human, never auto-accused);
 *  - unique  : nothing similar.
 *
 * Honest limits: a perceptual hash catches resizes, re-compression and small
 * edits, not a determined forger (crops, mirroring, heavy filters), and it can't
 * tell WHO made an image first — only who uploaded first. Hence the review path.
 */

/** Bits of 64 that may differ and still count as "the same picture". */
export const NEAR_THRESHOLD = 8;
/** A started-but-never-minted upload stops reserving its image after this long. */
export const PENDING_TTL_MS = 24 * 60 * 60_000;

export type DedupeEntry = {
  contentId: string;
  pixelHash: string;
  dhash: string;
  wallet: string;
  themeId: number;
  status: "pending" | "published";
  /** Set while pending. */
  expiresAt?: number;
  createdAt: number;
};

export type DedupeIndex = { version: 1; entries: DedupeEntry[] };
export const EMPTY_INDEX: DedupeIndex = { version: 1, entries: [] };

const alive = (e: DedupeEntry, now: number) => e.status === "published" || (e.expiresAt ?? 0) > now;

export type Verdict =
  | { kind: "unique" }
  | { kind: "exact"; of: DedupeEntry }
  | { kind: "own_pending"; of: DedupeEntry }
  | { kind: "near"; of: DedupeEntry; distance: number };

export function classify(index: DedupeIndex, hashes: { pixelHash: string; dhash: string }, wallet: string, now: number): Verdict {
  const live = index.entries.filter((e) => alive(e, now));

  const exact = live.find((e) => e.pixelHash === hashes.pixelHash);
  if (exact) return exact.wallet === wallet && exact.status === "pending" ? { kind: "own_pending", of: exact } : { kind: "exact", of: exact };

  let best: { of: DedupeEntry; distance: number } | null = null;
  for (const e of live) {
    const distance = hammingDistance(e.dhash, hashes.dhash);
    if (distance <= NEAR_THRESHOLD && (!best || distance < best.distance)) best = { of: e, distance };
  }
  return best ? { kind: "near", ...best } : { kind: "unique" };
}

/** Adds an entry (dropping expired pending ones). Never mutates the input. */
export function reserve(index: DedupeIndex, entry: DedupeEntry, now: number): DedupeIndex {
  return { ...index, entries: [...index.entries.filter((e) => alive(e, now) && e.contentId !== entry.contentId), entry] };
}

export function markPublished(index: DedupeIndex, contentId: string): DedupeIndex {
  return {
    ...index,
    entries: index.entries.map((e) => (e.contentId === contentId ? { ...e, status: "published" as const, expiresAt: undefined } : e)),
  };
}

export function release(index: DedupeIndex, contentId: string): DedupeIndex {
  return { ...index, entries: index.entries.filter((e) => e.contentId !== contentId) };
}
