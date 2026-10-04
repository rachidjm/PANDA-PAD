import { getRedis } from "@/lib/rate-limit";

/**
 * A short-lived cache for a wallet's computed Portfolio response (positions + prices + coin metadata) so
 * navigating back to /portfolio, or two tabs open on the same wallet, don't redo the external price/metadata
 * lookups every time — the expensive on-chain HISTORY SCAN already has its own once-a-day gate
 * (getBackfillMark/needsBackfill); this is the second, cheaper layer: the per-visit computation.
 * Correctness over staleness: a real trade recorded through PANDA invalidates this wallet's entry immediately
 * (see trade-log.ts), so a buy/sell you just made always shows up at once, cache or not. Read-route policy — if
 * Upstash isn't configured or is down, this just does nothing (the route falls back to recomputing).
 */

export const POSITIONS_CACHE_TTL_S = 60;
const KEY = (wallet: string) => `panda:portfolio:positions:v2:${wallet}`;

export async function getCachedPositions<T>(wallet: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return (await r.get<T>(KEY(wallet))) ?? null;
  } catch {
    return null;
  }
}

export async function setCachedPositions<T>(wallet: string, value: T, ttlSeconds = POSITIONS_CACHE_TTL_S): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(KEY(wallet), value, { ex: ttlSeconds });
  } catch {
    // Best-effort: a cache write failure never breaks the response that was already computed.
  }
}

export async function invalidatePositionsCache(wallet: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(KEY(wallet));
  } catch {
    // Worst case a stale entry lives out its 60s TTL — never fatal.
  }
}

/**
 * The "don't retry a failed history scan on every page load" gate (src/app/api/portfolio/positions/route.ts).
 * Redis-backed so the gate actually holds across serverless instances — an in-memory Map at module scope
 * doesn't persist between invocations on Vercel, so it was effectively a no-op in production, and a slow or
 * failing scan would re-run on nearly every visit. Falls back to a per-instance in-memory Map only when Redis
 * isn't configured (local dev) — still better than no gate at all there, and harmless once Redis is set.
 */
const ATTEMPT_KEY = (wallet: string) => `panda:portfolio:backfill-attempt:${wallet}`;
const localAttempts = new Map<string, number>();

export async function recentlyAttemptedBackfill(wallet: string, withinMs: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return Date.now() - (localAttempts.get(wallet) ?? 0) < withinMs;
  try {
    const last = await r.get<number>(ATTEMPT_KEY(wallet));
    return typeof last === "number" && Date.now() - last < withinMs;
  } catch {
    return false; // can't tell — better to allow one extra scan than to wrongly block all of them
  }
}

export async function markBackfillAttempted(wallet: string, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  if (!r) {
    localAttempts.set(wallet, Date.now());
    return;
  }
  try {
    await r.set(ATTEMPT_KEY(wallet), Date.now(), { ex: ttlSeconds });
  } catch {
    // Best-effort — worst case a retry happens sooner than intended, never fatal.
  }
}
