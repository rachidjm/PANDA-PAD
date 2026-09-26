import { getRedis } from "@/lib/rate-limit";
import { parseSummary, RUGCHECK_API, type RugSummary } from "./summary";

/**
 * Server-only. RugCheck summaries for the coin badge, cached in Upstash for 10 minutes so PANDA stays far under RugCheck's per-IP limit
 * (15 requests) however many people look at the same coins. A miss is fetched at most RUGCHECK_FETCH_PER_REQUEST at a time, and no more than
 * RUGCHECK_BUDGET_PER_MINUTE across the whole site; the rest are reported as `pending` and fill in on the next poll (the badge shows
 * nothing until it has a real answer). If RugCheck fails, times out, doesn't know the token or answers with something unusable, the result is
 * "nothing to show" — never a made-up state — and that is remembered only briefly so a broken token isn't retried on every page view.
 */

export const RUGCHECK_TTL_S = 10 * 60;
export const RUGCHECK_FAIL_TTL_S = 2 * 60;
export const RUGCHECK_BUDGET_PER_MINUTE = 12;
export const RUGCHECK_FETCH_PER_REQUEST = 4;
const TIMEOUT_MS = 4_000;
const KEY = (mint: string) => `panda:rugcheck:v1:${mint}`;

type Stored = { s: RugSummary | null };

// ── the cache (Upstash; a per-instance Map when Upstash isn't configured — local development and tests) ────────────────────
export interface Cache {
  get(mint: string): Promise<Stored | null>;
  set(mint: string, value: Stored, ttlSeconds: number): Promise<void>;
  /** Count one RugCheck call in this minute; true while still within the site-wide budget. */
  spend(limit: number): Promise<boolean>;
}

const memory = new Map<string, { v: Stored; exp: number }>();
const memoryBudget = new Map<number, number>();
const memoryCache: Cache = {
  async get(mint) {
    const e = memory.get(mint);
    return e && e.exp > Date.now() ? e.v : null;
  },
  async set(mint, v, ttl) {
    memory.set(mint, { v, exp: Date.now() + ttl * 1000 });
  },
  async spend(limit) {
    const minute = Math.floor(Date.now() / 60_000);
    for (const m of memoryBudget.keys()) if (m < minute) memoryBudget.delete(m);
    const n = (memoryBudget.get(minute) ?? 0) + 1;
    memoryBudget.set(minute, n);
    return n <= limit;
  },
};

function upstashCache(): Cache | null {
  const r = getRedis();
  if (!r) return null;
  return {
    async get(mint) {
      const v = await r.get<Stored>(KEY(mint));
      return v && typeof v === "object" && "s" in v ? v : null;
    },
    async set(mint, v, ttl) {
      await r.set(KEY(mint), v, { ex: ttl });
    },
    async spend(limit) {
      const key = `panda:rugcheck:v1:budget:${Math.floor(Date.now() / 60_000)}`;
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, 120);
      return n <= limit;
    },
  };
}

let testCache: Cache | null | undefined;
export function setRugCheckCacheForTests(c: Cache | null | undefined) {
  testCache = c;
}
export function clearMemoryCacheForTests() {
  memory.clear();
  memoryBudget.clear();
}
const cache = (): Cache => (testCache !== undefined && testCache !== null ? testCache : upstashCache() ?? memoryCache);

/** One request to RugCheck. null on anything but a usable report. */
export async function fetchRugSummary(mint: string, fetchImpl: typeof fetch = fetch): Promise<RugSummary | null> {
  try {
    const res = await fetchImpl(`${RUGCHECK_API}/${mint}/report/summary`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseSummary(await res.json());
  } catch {
    return null;
  }
}

export type RugBatch = { results: Record<string, RugSummary>; pending: string[] };

/** The summaries of these coins: from the cache when it has them, from RugCheck for a few misses, the rest reported as pending. */
export async function getRugSummaries(mints: string[], fetchImpl: typeof fetch = fetch): Promise<RugBatch> {
  const c = cache();
  const results: Record<string, RugSummary> = {};
  const misses: string[] = [];
  await Promise.all(
    mints.map(async (mint) => {
      try {
        const hit = await c.get(mint);
        if (hit) {
          if (hit.s) results[mint] = hit.s; // a remembered "nothing to show" is neither a result nor pending
        } else misses.push(mint);
      } catch {
        misses.push(mint); // the cache is down: behave as a miss (the budget below still protects RugCheck)
      }
    })
  );

  const pending: string[] = [];
  const toFetch: string[] = [];
  for (const mint of misses) {
    if (toFetch.length < RUGCHECK_FETCH_PER_REQUEST && (await c.spend(RUGCHECK_BUDGET_PER_MINUTE).catch(() => false))) toFetch.push(mint);
    else pending.push(mint);
  }
  await Promise.all(
    toFetch.map(async (mint) => {
      const s = await fetchRugSummary(mint, fetchImpl);
      if (s) results[mint] = s;
      await c.set(mint, { s }, s ? RUGCHECK_TTL_S : RUGCHECK_FAIL_TTL_S).catch(() => {});
    })
  );
  return { results, pending };
}
