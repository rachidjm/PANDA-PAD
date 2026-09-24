import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { cached } from "@/lib/activity/service";
import { realEconomyDeps } from "@/lib/economy/deps";
import { buildEconomy, EconomySnapshot } from "@/lib/economy/snapshot";

const cache = cached<EconomySnapshot>(60_000, 2);

/**
 * Public and read-only: PANDA's own numbers, each in its own unit and never added together (see
 * lib/economy/snapshot.ts). Cached for a minute because it reads many storage documents. A section that
 * couldn't be read comes back null with status "unavailable" — never as zero.
 */
export async function GET(req: Request) {
  if (await rateLimited(`economy:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const snapshot = await cache("economy", () => buildEconomy(realEconomyDeps()));
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "Couldn't build the economy snapshot." }, { status: 500 });
  }
}
