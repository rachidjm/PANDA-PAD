import { Coin } from "@/lib/types";

/**
 * Groups search results that are really the same coin's name/ticker launched over and over (the Discover
 * grid's own clone/spam filters — see clone-filter.ts — already drop a SCRIPTED ring's duplicates before a
 * search ever sees them; this is for the much more common case they don't touch: dozens of genuinely
 * independent people each launching their own, unrelated "$BONK"). Nothing is ever deleted — a coin is either
 * folded into its group (reachable via "+N coins with this name") or collapsed into "Mostrar resultados
 * ocultos" (near-zero liquidity, no 24h volume) — except the handful of things that must always stay on top:
 * an exact contract-address match, a PANDA-launched coin, or one the searching wallet holds.
 */

export type SearchRankOptions = {
  /** Below this (and with zero 24h volume) a coin is hidden-by-default — see src/lib/config/search-limits.ts. */
  minLiquidityUsd: number;
  /** How many times more liquidity an UNverified coin needs over a verified one to still win its group — the
   *  "or with much more liquidity than the rest" half of the ranking rule. */
  dominantLiquidityRatio: number;
  /** Two normalized names count as "near-identical" when their edit distance is at most this fraction of the
   *  longer name's length (floored at 2 characters) — tight enough that "Bonk Inu" and "Baby Bonk" (a real,
   *  different project) never match, loose enough that "BonkInu" and "Bonk  Inu." do. */
  nameMaxDistanceRatio: number;
};

export const DEFAULT_SEARCH_RANK_OPTIONS: SearchRankOptions = {
  minLiquidityUsd: 1000,
  dominantLiquidityRatio: 3,
  nameMaxDistanceRatio: 0.15,
};

export type RankedCoin = Coin & {
  /** Jupiter's own isVerified (src/lib/jupiter/tokens.ts) — absent/false for anything Jupiter doesn't list. */
  verified?: boolean;
};

export type SearchGroup = {
  /** The group's most relevant coin — what the card shows. */
  primary: RankedCoin;
  /** The rest of the group, already in relevance order, behind "+N coins with this name". */
  others: RankedCoin[];
};

export type SearchResultSet = {
  /** Already ordered: exact ticker match to the query first, then by relevance. */
  groups: SearchGroup[];
  /** Low-signal coins, collapsed by default — never deleted. Flat (not grouped): a dust-tier duplicate isn't
   *  worth clustering on its own, and keeping this list simple keeps "show hidden results" cheap to render. */
  hidden: RankedCoin[];
};

export function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Classic O(n*m) edit distance, two-row space. Coin names are short (a handful of words), so this is cheap. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = row;
  }
  return prev[b.length];
}

export function namesLookAlike(a: string, b: string, maxDistanceRatio: number): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length);
  const allowed = Math.max(2, Math.round(maxDistanceRatio * maxLen));
  return levenshteinDistance(na, nb) <= allowed;
}

/** Same ticker (normalized, exact) or a near-identical name — see namesLookAlike. */
export function sameIdentityGroup(a: Coin, b: Coin, opts: SearchRankOptions): boolean {
  if (a.mint === b.mint) return true;
  const ta = normalizeTicker(a.ticker);
  const tb = normalizeTicker(b.ticker);
  if (ta && ta === tb) return true;
  return namesLookAlike(a.name, b.name, opts.nameMaxDistanceRatio);
}

/** Connected components under `isMatch` (union-find) — a coin never joins more than one group, and a group's
 *  membership is its true transitive closure (A~B~C groups all three even if A and C alone wouldn't match). */
function buildGroups<T>(items: T[], isMatch: (a: T, b: T) => boolean): T[][] {
  const parent = items.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) x = parent[x];
    return x;
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (!isMatch(items[i], items[j])) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(item);
  });
  return [...groups.values()];
}

/**
 * Negative when `a` should rank ahead of `b` within a group. `pinned` (the exact contract-address match, if
 * the query was one) always wins outright — nothing else overrides a search for one specific coin. After
 * that: verified beats unverified UNLESS the unverified one has `dominantLiquidityRatio`×+ more liquidity (a
 * brand-new, genuinely bigger coin shouldn't lose to a stale "verified" tag on a dead one); then higher
 * liquidity; then higher 24h volume; then older (survived longer — a weak but real signal with no holder
 * count available here, see search-rank.test.ts for why).
 */
export function moreRelevant(a: RankedCoin, b: RankedCoin, opts: SearchRankOptions, pinned?: string | null): number {
  if (pinned) {
    if (a.mint === pinned && b.mint !== pinned) return -1;
    if (b.mint === pinned && a.mint !== pinned) return 1;
  }
  const aLiq = a.liquidityUsd ?? 0;
  const bLiq = b.liquidityUsd ?? 0;
  if (!!a.verified !== !!b.verified) {
    const aDominates = bLiq <= 0 ? aLiq > 0 : aLiq / bLiq >= opts.dominantLiquidityRatio;
    const bDominates = aLiq <= 0 ? bLiq > 0 : bLiq / aLiq >= opts.dominantLiquidityRatio;
    if (a.verified && !bDominates) return -1;
    if (b.verified && !aDominates) return 1;
    // The unverified side dominates on liquidity — fall through to the plain numeric comparison below.
  }
  if (aLiq !== bLiq) return bLiq - aLiq;
  if (a.volume24h !== b.volume24h) return b.volume24h - a.volume24h;
  const aAge = Date.parse(a.createdAt);
  const bAge = Date.parse(b.createdAt);
  if (Number.isFinite(aAge) && Number.isFinite(bAge) && aAge !== bAge) return aAge - bAge; // smaller (older) first
  return 0;
}

function isLowSignal(c: Coin, opts: SearchRankOptions): boolean {
  return (c.liquidityUsd ?? 0) < opts.minLiquidityUsd && (c.volume24h ?? 0) <= 0;
}

export type BuildSearchResultsInput = {
  /** A valid mint the query itself resolved to (the user pasted a contract address) — always shown, always
   *  first, even if it has no liquidity or would otherwise be folded into another coin's group. */
  exactMint?: string | null;
  /** Coins that must never be hidden regardless of liquidity — PANDA-launched coins and ones the searching
   *  wallet holds (src/app/api/coins/route.ts resolves these before calling in). */
  neverHide?: ReadonlySet<string>;
};

export function buildSearchResults(coins: RankedCoin[], query: string, opts: SearchRankOptions, input: BuildSearchResultsInput = {}): SearchResultSet {
  const exactMint = input.exactMint ?? null;
  const neverHide = input.neverHide ?? new Set<string>();
  const protect = (mint: string) => mint === exactMint || neverHide.has(mint);

  const visible: RankedCoin[] = [];
  const hidden: RankedCoin[] = [];
  for (const c of coins) {
    if (!protect(c.mint) && isLowSignal(c, opts)) hidden.push(c);
    else visible.push(c);
  }

  const rawGroups = buildGroups(visible, (a, b) => sameIdentityGroup(a, b, opts));
  const groups: SearchGroup[] = rawGroups.map((members) => {
    const ranked = [...members].sort((a, b) => moreRelevant(a, b, opts, exactMint));
    return { primary: ranked[0], others: ranked.slice(1) };
  });

  const queryTicker = normalizeTicker(query);
  groups.sort((ga, gb) => {
    if (queryTicker) {
      const aExact = normalizeTicker(ga.primary.ticker) === queryTicker;
      const bExact = normalizeTicker(gb.primary.ticker) === queryTicker;
      if (aExact !== bExact) return aExact ? -1 : 1;
    }
    return moreRelevant(ga.primary, gb.primary, opts, exactMint);
  });

  hidden.sort((a, b) => moreRelevant(a, b, opts, exactMint));
  return { groups, hidden };
}
