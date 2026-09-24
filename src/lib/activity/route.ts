import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { ACTIVITY_CONFIG as C } from "./config";
import { realFeedDeps } from "./deps";
import { cached, FeedResult, getFeed } from "./service";
import { FEED_FILTERS, FeedFilter } from "./types";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const feedCache = cached<FeedResult>();

/**
 * Shared by the public feed routes. Public and read-only; every input is validated, requests are rate
 * limited, and results are cached briefly so the third-party indexers aren't called on every request.
 */
export async function serveFeed(req: Request, fixedMint?: string): Promise<NextResponse> {
  if (await rateLimited(`activity:ip:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") ?? "all") as FeedFilter;
  if (!(FEED_FILTERS as readonly string[]).includes(filter)) return NextResponse.json({ error: "Invalid filter." }, { status: 400 });

  const mint = fixedMint ?? url.searchParams.get("mint") ?? undefined;
  if (mint !== undefined && !ADDRESS.test(mint)) return NextResponse.json({ error: "Invalid mint." }, { status: 400 });

  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? C.defaultLimit : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > C.maxLimit) return NextResponse.json({ error: "Invalid limit." }, { status: 400 });

  try {
    const result = await feedCache(`${filter}|${mint ?? ""}|${limit}`, () => getFeed(realFeedDeps(), { filter, mint, limit }));
    return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch {
    return NextResponse.json({ error: "Couldn't build the feed." }, { status: 500 });
  }
}
