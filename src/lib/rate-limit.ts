/**
 * Small in-memory sliding-window limiter for abuse-prone POST routes.
 *
 * Honest limitation: state lives in each serverless instance's memory, so
 * this blunts bursts and scripts hammering one instance but isn't a global
 * guarantee. Money-critical routes don't rely on it — they're protected by
 * atomic ledger reservations and payout caps (see src/lib/rewards/).
 */
const hits = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
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

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
