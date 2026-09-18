import { NextRequest, NextResponse } from "next/server";
import { fetchPoolOhlcv, GeckoOhlcvTimeframe } from "@/lib/gecko/client";

const PRESETS: Record<string, { timeframe: GeckoOhlcvTimeframe; aggregate: number; limit: number }> = {
  "5m": { timeframe: "minute", aggregate: 5, limit: 72 },
  "1h": { timeframe: "hour", aggregate: 1, limit: 48 },
  "4h": { timeframe: "hour", aggregate: 4, limit: 42 },
  "1d": { timeframe: "day", aggregate: 1, limit: 30 },
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
