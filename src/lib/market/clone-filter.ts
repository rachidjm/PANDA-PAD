import { Coin } from "@/lib/types";

/** Thresholds for what counts as "the same coin relaunched", both configurable and covered by tests. */
export type CloneSeriesOptions = {
  /** Max absolute difference (percentage points) between two coins' 24h change to count as "almost identical". */
  changePctToleranceAbs: number;
  /** Max ratio (larger/smaller) between two coins' market caps to still count as "almost identical". */
  marketCapMaxRatio: number;
  /** Max ratio (larger/smaller) between two coins' 24h volumes to still count as "almost identical". */
  volumeMaxRatio: number;
  /** How many normalized name/ticker tokens (length >= 3) two coins must share to look like the same template ("Super Wojak" / "Super Troll" share "super"). */
  minSharedNameTokens: number;
};

export const DEFAULT_CLONE_SERIES_OPTIONS: CloneSeriesOptions = {
  changePctToleranceAbs: 3,
  marketCapMaxRatio: 5,
  volumeMaxRatio: 6,
  minSharedNameTokens: 1,
};

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

function sharesTokens(a: Set<string>, b: Set<string>, min: number): boolean {
  let shared = 0;
  for (const w of b) {
    if (a.has(w)) shared++;
    if (shared >= min) return true;
  }
  return false;
}

/** Larger/smaller, or Infinity when either side is non-positive (can't be "almost identical" to zero). */
function ratio(x: number, y: number): number {
  if (x <= 0 || y <= 0) return Infinity;
  return Math.max(x, y) / Math.min(x, y);
}

/**
 * Same creator, near-identical 24h change, market cap and volume, and a shared name/ticker
 * template — this is what a "launch the same meme five times" spam series looks like, as
 * opposed to two genuinely different coins by a prolific creator that happen to share a stat.
 */
export function looksLikeCloneSeries(a: Coin, b: Coin, opts: CloneSeriesOptions = DEFAULT_CLONE_SERIES_OPTIONS): boolean {
  if (!a.creator || !b.creator || a.creator !== b.creator) return false;
  if (a.mint === b.mint) return false;
  const nameMatch = sharesTokens(nameTokens(a.name), nameTokens(b.name), opts.minSharedNameTokens) || sharesTokens(nameTokens(a.ticker), nameTokens(b.ticker), opts.minSharedNameTokens);
  if (!nameMatch) return false;
  if (Math.abs(a.changePct - b.changePct) > opts.changePctToleranceAbs) return false;
  if (ratio(a.marketCap, b.marketCap) > opts.marketCapMaxRatio) return false;
  if (ratio(a.volume24h, b.volume24h) > opts.volumeMaxRatio) return false;
  return true;
}

/**
 * Drops every coin in a same-creator "series" spam cluster except the one with the most
 * volume. A coin never joins more than one cluster (the highest-volume coin in the list is
 * always tried as a cluster leader first, so clusters form around the most-traded coin).
 */
export function filterCreatorSeriesSpam(coins: Coin[], opts: CloneSeriesOptions = DEFAULT_CLONE_SERIES_OPTIONS): Coin[] {
  const ordered = [...coins].sort((a, b) => b.volume24h - a.volume24h);
  const dropped = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const leader = ordered[i];
    if (dropped.has(leader.mint)) continue;
    for (let j = i + 1; j < ordered.length; j++) {
      const candidate = ordered[j];
      if (dropped.has(candidate.mint)) continue;
      if (looksLikeCloneSeries(leader, candidate, opts)) dropped.add(candidate.mint);
    }
  }
  return coins.filter((c) => !dropped.has(c.mint));
}

/** Coins that reuse the exact same image URL — free (no network), catches the common lazy-clone case. */
export function filterExactDuplicateImages(coins: Coin[]): Coin[] {
  const ordered = [...coins].sort((a, b) => b.volume24h - a.volume24h);
  const seen = new Set<string>();
  const dropped = new Set<string>();
  for (const c of ordered) {
    if (!c.image) continue;
    if (seen.has(c.image)) dropped.add(c.mint);
    else seen.add(c.image);
  }
  return coins.filter((c) => !dropped.has(c.mint));
}

/**
 * Applies already-computed perceptual image hashes (see image-hash.ts) the same way: within
 * every group of coins whose hashes are within `maxDistance` bits of each other, keep only
 * the one with the most volume. Coins with no hash (couldn't be fetched/decoded) are never
 * dropped by this step. Pure/testable — the actual hashing is real network+image-decode I/O,
 * done by the caller and passed in as `hashes`.
 */
export function filterByImageHash(coins: Coin[], hashes: Map<string, string>, maxDistance: number, distance: (a: string, b: string) => number): Coin[] {
  const ordered = [...coins].filter((c) => hashes.has(c.mint)).sort((a, b) => b.volume24h - a.volume24h);
  const dropped = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const leader = ordered[i];
    if (dropped.has(leader.mint)) continue;
    const leaderHash = hashes.get(leader.mint)!;
    for (let j = i + 1; j < ordered.length; j++) {
      const candidate = ordered[j];
      if (dropped.has(candidate.mint)) continue;
      const candidateHash = hashes.get(candidate.mint)!;
      if (distance(leaderHash, candidateHash) <= maxDistance) dropped.add(candidate.mint);
    }
  }
  return coins.filter((c) => !dropped.has(c.mint));
}
