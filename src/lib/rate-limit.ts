import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting for abuse-prone routes (phase 6, point 2). The counters live in Upstash Redis so every serverless instance
 * shares them (the in-memory limiter this replaces only ever saw one instance's traffic). The policy when Upstash can't answer
 * is decided per ROUTE KIND, not globally:
 *
 *   "money"  routes that build or send transactions, create coins, claim rewards/airdrops, mint or trade NFTs, place orders:
 *            FAIL CLOSED — if Upstash does not answer (down, slow, not configured in production) the request is refused with 503.
 *   "read"   everything else (reads, sign-in, admin): FAIL OPEN — it degrades to the per-instance in-memory limiter, so the site
 *            keeps working and is still throttled per instance. Admin is on purpose here: an emergency pause must never be
 *            blockable by a Redis outage.
 *
 * Outside production, with no Upstash configured, everything uses the in-memory limiter (local development and tests).
 * Keys are prefixed with the deployment environment so Preview traffic can't eat Production's budget.
 */

export type RatePolicy = "money" | "read";
export type RateVerdict = "ok" | "limited" | "unavailable";
/** true = allowed, false = over the limit; throws if the backend can't answer. */
export type RateBackend = (key: string, limit: number, windowMs: number) => Promise<boolean>;

const TIMEOUT_MS = 1_500;
/** After a backend failure it isn't asked again for this long, so an outage costs one timeout, not one per request. */
const BREAKER_MS = 5_000;

// ── per-instance fallback ─────────────────────────────────────────────────────────────────────────────────────────────
const hits = new Map<string, number[]>();

/** Sliding window in this instance's memory. true = limited. */
export function memoryLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);

  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return false;
}

// ── Upstash ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function upstashCredentials(env: Record<string, string | undefined> = process.env): { url: string; token: string } | null {
  // Vercel's Upstash/KV integration may inject either naming (sin verificar cuál usa hoy): both are accepted.
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  return url && token ? { url, token } : null;
}

const prefixFor = (env: Record<string, string | undefined> = process.env) => `panda:${env.VERCEL_ENV || env.NODE_ENV || "dev"}:rl`;

let redis: Redis | null = null;
const limiters = new Map<string, Ratelimit>();

export function getRedis(env: Record<string, string | undefined> = process.env): Redis | null {
  const c = upstashCredentials(env);
  if (!c) return null;
  redis ??= new Redis({ url: c.url, token: c.token });
  return redis;
}

/** The real backend: Upstash's sliding window. One Ratelimit object per (limit, window) pair. */
function upstashBackend(): RateBackend | null {
  const r = getRedis();
  if (!r) return null;
  return async (key, limit, windowMs) => {
    const id = `${limit}:${windowMs}`;
    let rl = limiters.get(id);
    if (!rl) {
      rl = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`), prefix: prefixFor(), analytics: false });
      limiters.set(id, rl);
    }
    return (await rl.limit(key)).success;
  };
}

let testBackend: RateBackend | null | undefined; // undefined = use the real one
export function setRateBackendForTests(backend: RateBackend | null | undefined): void {
  testBackend = backend;
  breakerUntil = 0;
}
let breakerUntil = 0;

const inProduction = () => process.env.NODE_ENV === "production";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`rate-limit backend did not answer in ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

let lastLog = 0;
function logOutage(reason: string) {
  if (Date.now() - lastLog < 30_000) return;
  lastLog = Date.now();
  console.error(`[PANDA rate-limit] Upstash unavailable (${reason}) — money routes are refused, other routes use the per-instance limiter`);
}

/**
 * The verdict for one request. `money` policy never returns "ok" without Upstash's own answer in production; `read` policy always
 * returns an answer (Upstash's, or the per-instance limiter's when Upstash can't be reached).
 */
export async function rateVerdict(key: string, limit: number, windowMs: number, policy: RatePolicy): Promise<RateVerdict> {
  const backend = testBackend !== undefined ? testBackend : upstashBackend();
  const fallback = (): RateVerdict => (memoryLimited(key, limit, windowMs) ? "limited" : "ok");

  if (!backend) {
    // Not configured: fine for development, an outage-equivalent in production.
    if (!inProduction()) return fallback();
    logOutage("not configured");
    return policy === "money" ? "unavailable" : fallback();
  }
  if (Date.now() < breakerUntil) return policy === "money" ? "unavailable" : fallback();

  try {
    return (await withTimeout(backend(key, limit, windowMs), TIMEOUT_MS)) ? "ok" : "limited";
  } catch (err) {
    breakerUntil = Date.now() + BREAKER_MS;
    logOutage(err instanceof Error ? err.message : "error");
    return policy === "money" ? "unavailable" : fallback();
  }
}

/** Reads, sign-in and admin (fail open). true = over the limit. */
export async function rateLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
  return (await rateVerdict(key, limit, windowMs, "read")) === "limited";
}

/**
 * Money routes (fail closed). Returns the response to send when the request must not proceed — 429 over the limit, 503 when the
 * limiter itself can't answer — or null when it may. `tooMany` lets a route keep its own 429 body.
 */
export async function moneyRateGate(key: string, limit: number, windowMs: number, tooMany?: () => NextResponse): Promise<NextResponse | null> {
  const v = await rateVerdict(key, limit, windowMs, "money");
  if (v === "ok") return null;
  if (v === "unavailable") return rateUnavailableResponse();
  return tooMany ? tooMany() : NextResponse.json({ error: "Too many requests — wait a moment and try again." }, { status: 429 });
}

export function rateUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: "This action is briefly unavailable — please try again in a minute.", code: "RATE_LIMIT_UNAVAILABLE" }, { status: 503, headers: { "Retry-After": "30" } });
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
