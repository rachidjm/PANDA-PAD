import { NextResponse } from "next/server";
import { getLiveCoins } from "@/lib/live-coins";
import { getRugSummaries } from "@/lib/rugcheck/server";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";

export const maxDuration = 30;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unguarded
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Runs every minute (vercel.json, Vercel Pro): keeps the coin list's shared cache (src/lib/live-coins.ts,
 * Upstash) and RugCheck's own cache (src/lib/rugcheck/server.ts) warm even when nobody is visiting, so the
 * first real visitor after a quiet spell never pays for a cold, blocking upstream fetch.
 *
 * `force: true` so THIS request awaits the full refresh itself, rather than relying on live-coins.ts's usual
 * fire-and-forget background revalidation (`void refreshCoinsInBackground()`) — a promise a serverless
 * function doesn't reliably keep running once its response has been sent. live-coins.ts's own 10s
 * MIN_FORCE_INTERVAL_MS guard is well under this cron's 1-minute cadence, so this never fights a real
 * visitor's own "force refresh" click. getRugSummaries is re-awaited here for the same reason: persistCoins
 * already warms it, but only as a fire-and-forget call — calling it again here, cache-aware and budget-capped
 * exactly as always, is what actually guarantees it finishes before this function returns.
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return new NextResponse(null, { status: 404 }); // a stranger learns nothing, not even that the route exists
  try {
    const { coins, live } = await getLiveCoins({ force: true });
    const { results } = await getRugSummaries(coins.map((c) => c.mint));
    const summary = { coins: coins.length, live, rugWarmed: Object.keys(results).length };
    await recordAudit({ actor: "system:cron", action: "cron.warm_coins", object: "live-coins", newState: summary });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Warm failed.";
    await alertOps("warm-coins cron failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
