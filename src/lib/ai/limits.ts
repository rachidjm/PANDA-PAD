import { getRedis } from "@/lib/rate-limit";

/**
 * Abuse and cost control for the AI Assistant — real money leaves PANDA on every call (OpenAI's own bill), so
 * this fails CLOSED like the app's other "money" routes: without Upstash configured in production, no AI call
 * is allowed (see src/lib/rate-limit.ts's own money/read split, which this mirrors).
 *
 * Two independent checks, both per UTC calendar day:
 *  - a QUOTA on who is asking (20 questions/day per wallet, 3/day per IP with no wallet connected — stops one
 *    visitor from burning the whole budget alone);
 *  - a BUDGET on the whole deployment's spend (AI_DAILY_BUDGET_USD, optional) — once today's real, measured
 *    OpenAI cost reaches it, every wallet sees "come back tomorrow" instead of a request failing outright.
 */

const WALLET_DAILY_LIMIT = 20;
const IP_DAILY_LIMIT = 3;
const A_DAY_SECONDS = 26 * 60 * 60; // a little over 24h, so a key issued late in the UTC day still expires well after it turns over

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

export type QuotaVerdict = { ok: true } | { ok: false; reason: "wallet_limit" | "ip_limit" | "unavailable" };

/** Increments and checks today's question count for this asker. Fails closed in production without Upstash. */
export async function aiQuotaCheck(wallet: string | null, ip: string): Promise<QuotaVerdict> {
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") return { ok: false, reason: "unavailable" };
    return { ok: true }; // local dev without Upstash configured
  }
  const day = utcDateKey();
  const limit = wallet ? WALLET_DAILY_LIMIT : IP_DAILY_LIMIT;
  const key = `panda:ai:q:${day}:${wallet ? `w:${wallet}` : `ip:${ip}`}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, A_DAY_SECONDS);
    if (count > limit) return { ok: false, reason: wallet ? "wallet_limit" : "ip_limit" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: "budget" | "unavailable" };

/** The configured daily cap, or null when none is set (AI_DAILY_BUDGET_USD unset/invalid — no spend cap, only the per-asker quota above applies). */
export function aiDailyBudgetUsd(env: Record<string, string | undefined> = process.env): number | null {
  const n = Number(env.AI_DAILY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Checked BEFORE calling OpenAI, so a day that already hit its cap never spends another cent finding out. */
export async function aiBudgetCheck(): Promise<BudgetVerdict> {
  const budget = aiDailyBudgetUsd();
  if (budget === null) return { ok: true };
  const redis = getRedis();
  if (!redis) return process.env.NODE_ENV === "production" ? { ok: false, reason: "unavailable" } : { ok: true };
  try {
    const spent = Number((await redis.get(`panda:ai:spend:${utcDateKey()}`)) ?? 0);
    return spent >= budget ? { ok: false, reason: "budget" } : { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Recorded AFTER a real OpenAI call, from its own real usage — never an estimate made up before the fact. */
export async function aiRecordSpend(costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = `panda:ai:spend:${utcDateKey()}`;
    await redis.incrbyfloat(key, costUsd);
    await redis.expire(key, A_DAY_SECONDS);
  } catch {
    // Best-effort: a spend that fails to record only means the budget check undercounts today, never a reason to fail the reply already given.
  }
}
