import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { rateLimited } from "@/lib/rate-limit";
import { realMarket } from "./deps";
import { miniappEnabled, sessionOf, type AppDeps, type AppError } from "./miniapp";

/**
 * The first lines of every Mini App route: the app must be on (otherwise the route does not exist: 404), the request
 * must carry a live session (401, and the app signs in again with Telegram's initData) and stay within a per-account rate.
 */
export async function appGate(req: Request, perMinute = 120): Promise<{ telegramId: number } | NextResponse> {
  if (!miniappEnabled()) return new NextResponse(null, { status: 404 });
  const session = sessionOf(req);
  if (!session) return NextResponse.json({ error: "Sign in again from Telegram.", code: "session" }, { status: 401 });
  if (await rateLimited(`tg-app:${session.telegramId}`, perMinute, 60_000)) return NextResponse.json({ error: "Too many requests.", code: "rate" }, { status: 429 });
  return session;
}

export const appDeps = (): AppDeps => ({ db: getDb(), market: realMarket, now: Date.now });

const STATUS: Record<AppError, number> = { invalid: 400, not_found: 404, full: 409, exists: 409, already_true: 409, unavailable: 503 };
export const appFail = (r: { error: AppError; current?: number }) => NextResponse.json({ error: r.error, code: r.error, ...(r.current !== undefined ? { current: r.current } : {}) }, { status: STATUS[r.error] });
export const noStore = { headers: { "Cache-Control": "no-store" } };
