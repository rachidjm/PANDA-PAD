import { NextResponse } from "next/server";
import { moneyRateGate } from "@/lib/rate-limit";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { isEnabled } from "@/lib/config/flags";
import { pausedResponse } from "@/lib/protocol/guard";
import { realMarketDeps } from "./deps";
import type { MarketDeps } from "./service";
import type { Failure } from "@/lib/nft/service";

/**
 * The checks every marketplace write route shares, in one place so none can be forgotten:
 * feature flag (404 when off), same-origin, the `nft_market` pause switch (only for routes that
 * START new work — completing or cancelling something already begun is never blocked, so a
 * seller can always take their listing down), a signed-in wallet session, a rate limit, and
 * the market authority being configured (503 otherwise: fail closed).
 */
export async function marketGate(
  req: Request,
  opts: { name: string; blockedWhenPaused: boolean; perMinute: number }
): Promise<{ wallet: string; deps: MarketDeps; body: Record<string, unknown> } | NextResponse> {
  if (!isEnabled("NFT_MARKET")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (opts.blockedWhenPaused) {
    const paused = await pausedResponse("nft_market");
    if (paused) return paused;
  }
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first.", code: "AUTH_REQUIRED" }, { status: 401 });
  // Listing, buying and cancelling move NFTs and SOL: fail closed if the limiter can't answer.
  const limited = await moneyRateGate(`market-${opts.name}:${wallet}`, opts.perMinute, 60_000, () => NextResponse.json({ error: "Too many attempts — wait a minute.", code: "RATE_LIMITED" }, { status: 429 }));
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request.", code: "BAD_REQUEST" }, { status: 400 });

  const deps = realMarketDeps(req);
  if (!deps) return NextResponse.json({ error: "The marketplace isn't configured yet.", code: "NOT_CONFIGURED" }, { status: 503 });
  return { wallet, deps, body };
}

export const failure = (f: Failure) => NextResponse.json({ error: f.error, code: f.code }, { status: f.status });
export const serverError = (label: string, err: unknown) => {
  console.error(`[PANDA] market ${label} failed`, String(err));
  return NextResponse.json({ error: "Something went wrong — nothing is lost; try again shortly.", code: "ERROR" }, { status: 500 });
};
