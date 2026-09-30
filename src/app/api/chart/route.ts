import { NextRequest, NextResponse } from "next/server";
import { fetchPoolOhlcv, GeckoOhlcvTimeframe } from "@/lib/gecko/client";

/**
 * Each timeframe's own real request to GeckoTerminal's OHLCV endpoint. Shortest to longest, and each one
 * genuinely covers what its name says (a past bug had "1d" pulling 30 DAYS of daily candles — a "30 days"
 * view mislabeled as "1 day", with no real "last 24h" view at all; fixed by giving every span its own,
 * correctly-sized request instead of reusing one preset for two different meanings).
 */
const PRESETS: Record<string, { timeframe: GeckoOhlcvTimeframe; aggregate: number; limit: number }> = {
  "1m": { timeframe: "minute", aggregate: 1, limit: 90 }, // ~1.5h
  "5m": { timeframe: "minute", aggregate: 5, limit: 72 }, // ~6h
  "1h": { timeframe: "hour", aggregate: 1, limit: 48 }, // ~2 days
  "4h": { timeframe: "hour", aggregate: 4, limit: 42 }, // ~7 days
  "1d": { timeframe: "minute", aggregate: 15, limit: 96 }, // last 24h, 15-minute candles
  "1w": { timeframe: "hour", aggregate: 1, limit: 168 }, // last 7 days, hourly
  "30d": { timeframe: "day", aggregate: 1, limit: 30 }, // last 30 days, daily
};

export async function GET(req: NextRequest) {
  const pool = req.nextUrl.searchParams.get("pool");
  const tf = req.nextUrl.searchParams.get("tf") || "1h";
  const preset = PRESETS[tf];

  if (!pool || !preset) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const candles = await fetchPoolOhlcv(pool, preset.timeframe, preset.aggregate, preset.limit);
  return NextResponse.json({ candles });
}
