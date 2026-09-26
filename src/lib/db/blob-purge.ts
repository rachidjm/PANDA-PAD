/**
 * Which Blob files are the FROZEN COPIES of the data that now lives in Postgres — and nothing else. The purge script (scripts/blob-purge.ts)
 * deletes only what `isMigratedBlobPath` says yes to; images, metadata and the files of every feature that has NOT moved to Postgres
 * (points, airdrops, themes/NFT, market, branches, abuse, strategies, OTC) are never matched. Keep this list in step with
 * `blobSource` (src/lib/db/source.ts) and the domains in src/lib/db/mode.ts: src/lib/db/blob-purge.test.ts checks both.
 */

/** Exact files and folders (a trailing "/" means "everything under it"), by migrated domain. */
export const MIGRATED_BLOB_PATHS: Record<string, string[]> = {
  rewards: ["rewards/registry.json", "rewards/payout-day.json", "rewards/ledger/"],
  trades: ["portfolio/trades/", "portfolio/backfill/"],
  activity: ["activity/journal/", "economy/daily/", "economy/total.json"],
  pause: ["protocol/pause.json"],
  audit: ["audit/events/"],
  sessions: ["auth/nonces/"],
  launch: ["launch/pending-fee-lock.json"],
};

const ALL = Object.values(MIGRATED_BLOB_PATHS).flat();

/** True only for a path that is exactly a listed file, or lies under a listed folder. */
export function isMigratedBlobPath(pathname: string): boolean {
  if (pathname.includes("..") || pathname.startsWith("/")) return false;
  return ALL.some((p) => (p.endsWith("/") ? pathname.startsWith(p) && pathname.length > p.length : pathname === p));
}

/** The prefixes to list in Blob (folders as they are; a single file lists itself). */
export const PURGE_LIST_PREFIXES = ALL;

export type BlobMeta = { pathname: string; url: string; size: number; uploadedAt: Date };

export type PurgePlan = {
  toDelete: BlobMeta[];
  /** Listed but not on the allowlist — never deleted (should be empty: the listing is by allowed prefix). */
  ignored: BlobMeta[];
  bytes: number;
  newestUploadedAt: number | null;
  /** The frozen copies were written less than `minAgeDays` ago: the retention period isn't over. */
  tooFresh: boolean;
  /** Earliest day the purge is allowed (newest write + minAgeDays), ISO date; null with nothing to delete. */
  allowedFrom: string | null;
};

/** Pure: decides what may be deleted. The retention clock starts at the NEWEST write among the candidates (that is when the copy froze). */
export function planPurge(blobs: BlobMeta[], now: number, minAgeDays: number): PurgePlan {
  const toDelete = blobs.filter((b) => isMigratedBlobPath(b.pathname));
  const ignored = blobs.filter((b) => !isMigratedBlobPath(b.pathname));
  const newest = toDelete.length ? Math.max(...toDelete.map((b) => b.uploadedAt.getTime())) : null;
  const allowedAt = newest === null ? null : newest + minAgeDays * 86_400_000;
  return {
    toDelete,
    ignored,
    bytes: toDelete.reduce((s, b) => s + b.size, 0),
    newestUploadedAt: newest,
    tooFresh: allowedAt !== null && now < allowedAt,
    allowedFrom: allowedAt === null ? null : new Date(allowedAt).toISOString().slice(0, 10),
  };
}
