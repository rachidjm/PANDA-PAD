import { getRedis } from "@/lib/rate-limit";
import type { Violation } from "./csp";

/**
 * Aggregated CSP violation counts in Upstash Redis (one hash, 30-day expiry, at most MAX_FIELDS distinct kinds): what the report-only
 * period is for. Only origins, directive names and page PATHS are kept (see parseViolations) — never full URLs or query strings.
 * Best-effort: without Redis reports are just dropped.
 */
const KEY = "panda:csp:v1:counts";
const MAX_FIELDS = 500;
const TTL_SECONDS = 30 * 24 * 3600;

const fieldOf = (v: Violation) => `${v.directive}|${v.blocked}|${v.page}|${v.source}`;

export async function recordViolations(list: Violation[]): Promise<void> {
  if (list.length === 0) return;
  const redis = getRedis();
  if (!redis) {
    console.info("[PANDA csp] violation (no Redis to aggregate)", JSON.stringify(list));
    return;
  }
  try {
    const known = await redis.hlen(KEY);
    for (const v of list) {
      const field = fieldOf(v);
      if (known >= MAX_FIELDS && !(await redis.hexists(KEY, field))) continue;
      await redis.hincrby(KEY, field, 1);
    }
    await redis.expire(KEY, TTL_SECONDS);
  } catch (err) {
    console.error("[PANDA csp] could not store violations", err instanceof Error ? err.message : err);
  }
}

export type ViolationCount = Violation & { count: number };

export async function topViolations(limit = 50): Promise<ViolationCount[]> {
  const redis = getRedis();
  if (!redis) return [];
  const all = (await redis.hgetall<Record<string, number | string>>(KEY)) ?? {};
  return Object.entries(all)
    .map(([field, count]) => {
      const [directive = "", blocked = "", page = "", source = ""] = field.split("|");
      return { directive, blocked, page, source, count: Number(count) };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
