import { getRedis } from "@/lib/rate-limit";
import { fetchJupiterTokens } from "./tokens";

/**
 * `verified`/`liquidityUsd` from Jupiter's token list (src/lib/jupiter/tokens.ts), cached so a search's ranking
 * (src/lib/market/search-rank.ts) never waits on Jupiter for a mint it already asked about recently — a
 * token's verified status and liquidity tier both change slowly, so a page refresh or a slightly different
 * search term reuses the same answer instead of a fresh round trip. Same cache/budget-free shape as
 * src/lib/rugcheck/server.ts, minus the rate budget (lite-api.jup.ag has no documented per-IP limit here).
 */

export type Verification = { verified: boolean; liquidityUsd?: number };

const TTL_S = 10 * 60;
const KEY = (mint: string) => `panda:jupverify:v1:${mint}`;

interface Cache {
  get(mint: string): Promise<Verification | null>;
  set(mint: string, value: Verification): Promise<void>;
}

const memory = new Map<string, { v: Verification; exp: number }>();
const memoryCache: Cache = {
  async get(mint) {
    const e = memory.get(mint);
    return e && e.exp > Date.now() ? e.v : null;
  },
  async set(mint, v) {
    memory.set(mint, { v, exp: Date.now() + TTL_S * 1000 });
  },
};

function upstashCache(): Cache | null {
  const r = getRedis();
  if (!r) return null;
  return {
    async get(mint) {
      const v = await r.get<Verification>(KEY(mint));
      return v && typeof v === "object" ? v : null;
    },
    async set(mint, v) {
      await r.set(KEY(mint), v, { ex: TTL_S });
    },
  };
}

let testCache: Cache | null | undefined;
export function setVerificationCacheForTests(c: Cache | null | undefined) {
  testCache = c;
}
export function clearVerificationMemoryCacheForTests() {
  memory.clear();
}
const cache = (): Cache => (testCache !== undefined && testCache !== null ? testCache : upstashCache() ?? memoryCache);

/** The verification/liquidity info for these mints — from the cache where it has them, from Jupiter for the
 *  rest (one batched call, up to 100 mints — see fetchJupiterTokens). Never throws: a Jupiter outage just
 *  means nothing is verified this round, never a reason search itself fails. */
export async function getJupiterVerifications(mints: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, Verification>> {
  const unique = [...new Set(mints)];
  const results = new Map<string, Verification>();
  if (unique.length === 0) return results;

  const c = cache();
  const misses: string[] = [];
  await Promise.all(
    unique.map(async (mint) => {
      try {
        const hit = await c.get(mint);
        if (hit) results.set(mint, hit);
        else misses.push(mint);
      } catch {
        misses.push(mint); // cache down: behave as a miss
      }
    })
  );

  if (misses.length > 0) {
    try {
      const fetched = await fetchJupiterTokens(misses, fetchImpl);
      await Promise.all(
        misses.map(async (mint) => {
          const t = fetched.get(mint);
          const info: Verification = { verified: t?.verified ?? false, liquidityUsd: t?.liquidityUsd };
          results.set(mint, info);
          await c.set(mint, info).catch(() => {});
        })
      );
    } catch {
      // Jupiter down/slow: the misses simply stay unverified this round, nothing cached for them.
    }
  }

  return results;
}
