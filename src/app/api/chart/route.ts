import { NextRequest, NextResponse } from "next/server";
import { fetchPoolOhlcv } from "@/lib/gecko/client";
import { fetchPoolOhlcvDexPaprika } from "@/lib/dexpaprika/client";
import { GECKO_PRESETS, DEXPAPRIKA_FALLBACKS, TIMEFRAMES, type Timeframe } from "@/lib/chart/config";
import { getChartCache, setChartCache, isFresh } from "@/lib/chart/cache";

function isTimeframe(v: string | null): v is Timeframe {
  return !!v && (TIMEFRAMES as readonly string[]).includes(v);
}

/**
 * Real candles, cached per (pool, timeframe) in Upstash so most requests never touch an upstream at all (see
 * chart/cache.ts), GeckoTerminal first, DexPaprika as a real-but-partial fallback when it fails or is
 * rate-limited (chart/config.ts documents exactly which tabs that can stand in for, and why not all of them
 * can). When both fail, a cache entry past its fresh TTL is still served if one exists — real data for the
 * right tab, just a little older — rather than an empty chart.
 */
export async function GET(req: NextRequest) {
  const pool = req.nextUrl.searchParams.get("pool");
  const tfParam = req.nextUrl.searchParams.get("tf") || "1h";

  if (!pool || !isTimeframe(tfParam)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const tf = tfParam;

  const cached = await getChartCache(pool, tf);
  if (cached && isFresh(cached, tf)) {
    return NextResponse.json({ candles: cached.candles });
  }

  const preset = GECKO_PRESETS[tf];
  let candles = await fetchPoolOhlcv(pool, preset.timeframe, preset.aggregate, preset.limit);
  let source: "gecko" | "dexpaprika" = "gecko";

  if (candles.length < 2) {
    const fb = DEXPAPRIKA_FALLBACKS[tf];
    const apiKey = process.env.DEXPAPRIKA_API_KEY;
    if (fb && (!fb.needsKey || apiKey)) {
      const fallbackCandles = await fetchPoolOhlcvDexPaprika(pool, { start: fb.start, interval: fb.interval, limit: fb.limit }, apiKey);
      if (fallbackCandles.length >= 2) {
        candles = fallbackCandles;
        source = "dexpaprika";
      }
    }
  }

  if (candles.length >= 2) {
    await setChartCache(pool, tf, { candles, fetchedAt: Date.now(), source });
    return NextResponse.json({ candles });
  }

  // Both the primary and the fallback came back empty — a stale cache entry (still this exact pool+tf) beats nothing.
  if (cached) return NextResponse.json({ candles: cached.candles });
  return NextResponse.json({ candles: [] });
}
