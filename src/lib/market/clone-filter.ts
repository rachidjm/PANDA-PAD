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
 * Two 24h-change figures are "close enough" if they're close in absolute percentage points (fine for
 * small, everyday changes) OR close in ratio (needed once the numbers themselves are huge: a scripted
 * ring reporting +1363% and +1354% is only 0.7% apart in relative terms, but 9 points apart in absolute
 * terms — real production data (panda-pad.vercel.app/discover, 2026-10-03: HULKINU +1363%, PMASK +1357%,
 * SEAPUG +1354%) showed a pure absolute tolerance missing exactly this kind of ring). `ratio` already
 * returns Infinity for a non-positive side, so two coins can't "match" via a loss turning into a gain.
 */
function closeEnoughPct(a: number, b: number, toleranceAbs: number, maxRatio: number): boolean {
  if (Math.abs(a - b) <= toleranceAbs) return true;
  return ratio(a, b) <= maxRatio;
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

/** Drops every coin in a cluster of mutually-matching coins (per `isMatch`) except the one with
 *  the most volume. A coin never joins more than one cluster — the highest-volume coin in the
 *  list is always tried as a cluster leader first, so clusters form around the most-traded coin. */
function clusterAndKeepTopVolume(coins: Coin[], isMatch: (a: Coin, b: Coin) => boolean): Coin[] {
  const ordered = [...coins].sort((a, b) => b.volume24h - a.volume24h);
  const dropped = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const leader = ordered[i];
    if (dropped.has(leader.mint)) continue;
    for (let j = i + 1; j < ordered.length; j++) {
      const candidate = ordered[j];
      if (dropped.has(candidate.mint)) continue;
      if (isMatch(leader, candidate)) dropped.add(candidate.mint);
    }
  }
  return coins.filter((c) => !dropped.has(c.mint));
}

/**
 * Drops every coin in a same-creator "series" spam cluster except the one with the most
 * volume — see looksLikeCloneSeries.
 */
export function filterCreatorSeriesSpam(coins: Coin[], opts: CloneSeriesOptions = DEFAULT_CLONE_SERIES_OPTIONS): Coin[] {
  return clusterAndKeepTopVolume(coins, (a, b) => looksLikeCloneSeries(a, b, opts));
}

/** Thresholds for the cross-creator template-spam check — tighter than CloneSeriesOptions since,
 *  without the same-creator signal, only near-exact matches are safe to treat as one coin. */
export type TemplateSpamOptions = {
  changePctToleranceAbs: number;
  /** Relative fallback for changePctToleranceAbs — see closeEnoughPct. */
  changePctMaxRatio: number;
  marketCapMaxRatio: number;
  volumeMaxRatio: number;
  minSharedNameTokens: number;
};

export const DEFAULT_TEMPLATE_SPAM_OPTIONS: TemplateSpamOptions = {
  changePctToleranceAbs: 5,
  changePctMaxRatio: 1.1,
  marketCapMaxRatio: 1.15,
  volumeMaxRatio: 1.15,
  minSharedNameTokens: 1,
};

/**
 * A scripted "launch the same template from a fresh wallet every time" spam ring: real production
 * data showed five coins named "Super <word>" from five DIFFERENT creator wallets, all reporting
 * the exact same 24h change (+1360%) and market caps/volumes within ~1% of each other — numbers
 * that close, on a shared name template, are astronomically unlikely between genuinely independent
 * coins, so this doesn't require looksLikeCloneSeries' same-creator gate (a coincidence this tight
 * across independent launches essentially never happens; a real copycat-by-design scheme does).
 */
export function looksLikeTemplateSpam(a: Coin, b: Coin, opts: TemplateSpamOptions = DEFAULT_TEMPLATE_SPAM_OPTIONS): boolean {
  if (a.mint === b.mint) return false;
  const nameMatch = sharesTokens(nameTokens(a.name), nameTokens(b.name), opts.minSharedNameTokens) || sharesTokens(nameTokens(a.ticker), nameTokens(b.ticker), opts.minSharedNameTokens);
  if (!nameMatch) return false;
  if (!closeEnoughPct(a.changePct, b.changePct, opts.changePctToleranceAbs, opts.changePctMaxRatio)) return false;
  if (ratio(a.marketCap, b.marketCap) > opts.marketCapMaxRatio) return false;
  if (ratio(a.volume24h, b.volume24h) > opts.volumeMaxRatio) return false;
  return true;
}

/** Drops every coin in a cross-creator template-spam cluster except the one with the most volume — see looksLikeTemplateSpam. */
export function filterTemplateSpam(coins: Coin[], opts: TemplateSpamOptions = DEFAULT_TEMPLATE_SPAM_OPTIONS): Coin[] {
  return clusterAndKeepTopVolume(coins, (a, b) => looksLikeTemplateSpam(a, b, opts));
}

/** Thresholds for the name-agnostic stats-ring check — see filterStatsOnlyRing. */
export type StatsRingOptions = {
  changePctToleranceAbs: number;
  /** Relative fallback for changePctToleranceAbs — see closeEnoughPct. */
  changePctMaxRatio: number;
  marketCapMaxRatio: number;
  volumeMaxRatio: number;
  /** A cluster must have at least this many coins before any of them get dropped — with no name or
   *  creator signal, a lone pair this close could still be coincidence; three or more at once essentially never is. */
  minClusterSize: number;
};

export const DEFAULT_STATS_RING_OPTIONS: StatsRingOptions = {
  changePctToleranceAbs: 3,
  changePctMaxRatio: 1.1,
  marketCapMaxRatio: 1.1,
  volumeMaxRatio: 1.1,
  minClusterSize: 3,
};

function looksLikeStatsOnlyMatch(a: Coin, b: Coin, opts: StatsRingOptions): boolean {
  if (a.mint === b.mint) return false;
  if (!closeEnoughPct(a.changePct, b.changePct, opts.changePctToleranceAbs, opts.changePctMaxRatio)) return false;
  if (ratio(a.marketCap, b.marketCap) > opts.marketCapMaxRatio) return false;
  if (ratio(a.volume24h, b.volume24h) > opts.volumeMaxRatio) return false;
  return true;
}

/** Groups coins into connected components under `isMatch` (union-find) — unlike clusterAndKeepTopVolume's
 *  greedy leader pass, this gives every cluster's true membership so callers can gate on its size. */
function buildMatchClusters(coins: Coin[], isMatch: (a: Coin, b: Coin) => boolean): Coin[][] {
  const parent = coins.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) x = parent[x];
    return x;
  }
  for (let i = 0; i < coins.length; i++) {
    for (let j = i + 1; j < coins.length; j++) {
      if (!isMatch(coins[i], coins[j])) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
  }
  const groups = new Map<number, Coin[]>();
  coins.forEach((c, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(c);
  });
  return [...groups.values()];
}

/**
 * Catches a scripted spam ring that varies the name every launch (so no shared name template exists for
 * filterTemplateSpam to key off) but can't hide reusing the same bot/numbers: three or more coins with
 * near-identical 24h change, market cap AND volume all at once, regardless of name or creator. Real
 * production data (panda-pad.vercel.app/discover, 2026-10-03): CHILLMASK, HOOKEDGUY, SKI, VRAXWEEN,
 * HULKINU, MOOON, PMASK, SEAPUG, PM — nine unrelated-looking names, every one +1369% with ~49K market
 * cap and ~10.1K volume (the same shape as the earlier "Super X" ring, just renamed). Two coins this
 * close on three independent metrics at once could be coincidence; a cluster of three or more essentially
 * never is among genuinely independent coins — hence the minClusterSize gate.
 */
export function filterStatsOnlyRing(coins: Coin[], opts: StatsRingOptions = DEFAULT_STATS_RING_OPTIONS): Coin[] {
  const clusters = buildMatchClusters(coins, (a, b) => looksLikeStatsOnlyMatch(a, b, opts));
  const dropped = new Set<string>();
  for (const cluster of clusters) {
    if (cluster.length < opts.minClusterSize) continue;
    const top = [...cluster].sort((a, b) => b.volume24h - a.volume24h)[0];
    for (const c of cluster) if (c.mint !== top.mint) dropped.add(c.mint);
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
