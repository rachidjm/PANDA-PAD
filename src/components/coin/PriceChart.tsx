"use client";

import { useEffect, useRef, useState } from "react";
import { formatPct, formatPrice, formatCompact } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { Coin } from "@/lib/types";
import { CHART, clientYToChartY, domainFor, priceToY, yToPrice } from "@/lib/strategy/scale";
import { useDrawTrade } from "@/components/coin/draw/useDrawTrade";
import DrawTradePanel from "@/components/coin/draw/DrawTradePanel";
import { PriceTags, StrategyLines, type ChartOverlayData } from "@/components/coin/draw/ChartOverlay";

const timeframes = ["1m", "5m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof timeframes)[number];

type Candle = { time: number; close: number };

export default function PriceChart({
  poolAddress,
  initialCloses,
  changePct,
  marketCap,
  coin,
}: {
  /** When given, the chart also offers "Draw Your Trade" (strategy lines drawn on top of it). */
  coin?: Coin;
  poolAddress?: string;
  initialCloses: number[];
  changePct: number;
  /** Real, current market cap (from the same live snapshot as `initialCloses`) — used to
   * derive a market cap for every point on the chart via a constant supply ratio, since
   * GeckoTerminal's OHLCV endpoint only returns price, never a market-cap history. */
  marketCap?: number;
}) {
  const { t } = useLanguage();
  // Minute candles by default — the richest, most "alive" view of a coin
  // that's actually trading. `initialCloses` (server-rendered) is hourly and
  // has no real per-point timestamps, so this fires once on mount to swap in
  // real, timestamped 1-minute data right away.
  const [tf, setTf] = useState<Timeframe>("1m");
  const [candles, setCandles] = useState<Candle[]>(initialCloses.map((close) => ({ time: 0, close })));
  const [hasRealTimes, setHasRealTimes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(false);

  function loadTimeframe(next: Timeframe) {
    if (!poolAddress) return;
    const id = ++requestId.current;
    setLoading(true);
    fetch(`/api/chart?pool=${poolAddress}&tf=${next}`)
      .then((r) => r.json())
      .then((data: { candles?: Candle[] }) => {
        if (requestId.current !== id) return;
        const points = data.candles || [];
        if (points.length > 1) {
          setCandles(points);
          setHasRealTimes(true);
        }
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
  }

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    loadTimeframe("1m");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTimeframe(next: Timeframe) {
    setTf(next);
    setHoverIndex(null);
    if (!poolAddress || next === tf) return;
    loadTimeframe(next);
  }

  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1] ?? 0;
  // Constant-supply ratio, anchored to the real current price/market cap this
  // page loaded with — not refetched per candle, since none of GeckoTerminal,
  // Dexscreener, or the OHLCV endpoint expose a market-cap history.
  const supply = marketCap && lastClose > 0 ? marketCap / lastClose : undefined;

  const draw = useDrawTrade(coin ?? null, lastClose);
  const overlay: ChartOverlayData | undefined = coin
    ? {
        lines: draw.lines,
        drawing: draw.machine.target,
        preview: draw.machine.preview,
        onPointer: draw.onPointer,
        labels: { buy: t("draw.line.buy"), sell: t("draw.line.sell"), stop: t("draw.line.stop") },
        previewLabels: { buy: t("draw.line.buyTarget"), sell: t("draw.line.sellTarget"), stop: t("draw.line.stopTarget") },
      }
    : undefined;

  const shown = hoverIndex !== null ? hoverIndex : closes.length - 1;
  const shownPrice = closes[shown] ?? 0;
  const shownMarketCap = supply !== undefined ? shownPrice * supply : undefined;
  const shownTime = hasRealTimes ? candles[shown]?.time : undefined;

  const windowChangePct = closes.length > 1 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : changePct;
  const positive = windowChangePct >= 0;
  const low = closes.length ? Math.min(...closes) : 0;
  const high = closes.length ? Math.max(...closes) : 0;

  return (
    <div className="rounded-[26px] border border-paper/10 bg-ink-raised p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-bold sm:text-3xl">{formatPrice(shownPrice)}</p>
          <p className={`text-sm font-semibold ${positive ? "text-bamboo" : "text-clay-red"}`}>
            {formatPct(windowChangePct)} <span className="text-panda-grey font-normal">· {tf.toUpperCase()}</span>
          </p>
          {shownMarketCap !== undefined && (
            <p className="mt-0.5 text-xs text-panda-grey">
              {t("chart.mc")}: <span className="font-medium text-paper/80">{formatCompact(shownMarketCap)}</span>
              {hoverIndex !== null && shownTime ? (
                <span> · {formatAxisTime(shownTime, tf, true)}</span>
              ) : null}
            </p>
          )}
        </div>
        <div className="flex gap-1 rounded-full bg-ink p-1">
          {timeframes.map((tfOption) => (
            <button
              key={tfOption}
              onClick={() => selectTimeframe(tfOption)}
              disabled={!poolAddress}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase transition-colors disabled:opacity-40 sm:px-3 sm:py-1.5 ${
                tf === tfOption ? "bg-paper text-ink" : "text-panda-grey hover:text-paper/80"
              }`}
            >
              {tfOption}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-4 transition-opacity duration-500 sm:mt-6 ${loading ? "opacity-40" : "opacity-100"}`}>
        <AreaChart
          candles={candles}
          positive={positive}
          noDataLabel={t("chart.noData")}
          hasRealTimes={hasRealTimes}
          tf={tf}
          hoverIndex={hoverIndex}
          onHover={setHoverIndex}
          overlay={overlay}
        />
      </div>

      {closes.length > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-panda-grey">
          <span>{t("chart.low", { value: formatPrice(low) })}</span>
          <span>{t("chart.high", { value: formatPrice(high) })}</span>
        </div>
      )}

      {coin && <DrawTradePanel draw={draw} coin={coin} />}
    </div>
  );
}


/** Catmull-Rom-ish smoothing: turns the polyline into a fluid curve through
 * every real data point (no data is invented, only how it's connected). */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 3) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/** `real` picks a fuller "day, HH:MM" format for the small inline caption; the x-axis ticks stay short. */
function formatAxisTime(epochSeconds: number, tf: Timeframe, real = false): string {
  const d = new Date(epochSeconds * 1000);
  if (tf === "1d") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!real) return time;
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

function AreaChart({
  candles,
  positive,
  noDataLabel,
  hasRealTimes,
  tf,
  hoverIndex,
  onHover,
  overlay,
}: {
  overlay?: ChartOverlayData;
  candles: Candle[];
  positive: boolean;
  noDataLabel: string;
  hasRealTimes: boolean;
  tf: Timeframe;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}) {
  const { width, height, padding } = CHART;
  const svgRef = useRef<SVGSVGElement>(null);
  const data = candles.map((c) => c.close);

  if (data.length < 2) {
    return <div className="flex h-[170px] items-center justify-center text-sm text-panda-grey sm:h-[260px]">{noDataLabel}</div>;
  }

  // With no strategy lines and nothing being drawn this is exactly min..max of the closes (the chart as it always was);
  // lines that already exist stay in view, and while drawing there is headroom to place a target beyond the recent range.
  const domain = domainFor(data, overlay ? overlay.lines.map((l) => l.price) : [], overlay?.drawing ? 0.25 : 0);
  const step = (width - padding * 2) / (data.length - 1);
  const color = positive ? "var(--bamboo)" : "var(--clay-red)";

  const points = data.map((v, i) => {
    const x = padding + i * step;
    const y = priceToY(v, domain);
    return { x, y };
  });

  const line = smoothPath(points);
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${height - padding} L${points[0].x.toFixed(1)},${height - padding} Z`;
  const gradientId = `chart-fill-${positive ? "up" : "down"}`;
  const activeIndex = hoverIndex !== null ? hoverIndex : points.length - 1;
  const active = points[activeIndex];

  const drawing = !!overlay?.drawing;

  /** The price under a pointer event, from the chart's own scale (the same one that draws the curve). */
  function priceAt(e: React.PointerEvent<SVGSVGElement>): number {
    const rect = svgRef.current!.getBoundingClientRect();
    return yToPrice(clientYToChartY(e.clientY, rect.top, rect.height), domain);
  }
  const info = (e: React.PointerEvent<SVGSVGElement>) => ({ type: e.pointerType, button: e.button, pressed: e.buttons > 0 });

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    if (drawing) {
      overlay!.onPointer("move", priceAt(e), info(e));
      return;
    }
    const rect = svg.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(relX * (points.length - 1));
    onHover(Math.max(0, Math.min(points.length - 1, idx)));
  }

  // Up to 5 evenly-spaced real timestamps along the bottom, so the timeline
  // itself is visible, not just implied by the curve's shape.
  const axisTicks =
    hasRealTimes && candles.length > 1
      ? [0, 0.25, 0.5, 0.75, 1].map((f) => {
          const idx = Math.round(f * (candles.length - 1));
          return { x: points[idx].x, label: formatAxisTime(candles[idx].time, tf) };
        })
      : [];

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerLeave={() => (drawing ? overlay!.onPointer("leave", 0, { type: "mouse", button: 0, pressed: false }) : onHover(null))}
        onPointerDown={
          drawing
            ? (e) => {
                // Keep receiving the finger's moves and its lift even if it slides off the chart.
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {}
                overlay!.onPointer("down", priceAt(e), info(e));
              }
            : undefined
        }
        onPointerUp={drawing ? (e) => overlay!.onPointer("up", priceAt(e), info(e)) : undefined}
        onPointerCancel={drawing ? () => overlay!.onPointer("leave", 0, { type: "touch", button: 0, pressed: false }) : undefined}
        className="h-[170px] w-full cursor-crosshair sm:h-[260px]"
        // While placing a line the finger must move the line, not scroll the page; otherwise the page scrolls as usual.
        style={drawing ? { touchAction: "none" } : undefined}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={padding + (height - padding * 2) * f}
            y2={padding + (height - padding * 2) * f}
            stroke="var(--paper)"
            strokeOpacity="0.06"
          />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          key={data.length}
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          style={{ animation: "panda-chart-draw 900ms ease-out" }}
        />

        {overlay && <StrategyLines overlay={overlay} domain={domain} />}

        {hoverIndex !== null && !drawing && (
          <line x1={active.x} x2={active.x} y1={padding} y2={height - padding} stroke="var(--paper)" strokeOpacity="0.25" strokeDasharray="3 3" />
        )}

        <circle cx={active.x} cy={active.y} r={hoverIndex !== null && !drawing ? 5 : 4} fill={color}>
          {(hoverIndex === null || drawing) && (
            <>
              <animate attributeName="r" values="4;7;4" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite" />
            </>
          )}
        </circle>
        <style>{`
          @keyframes panda-chart-draw {
            from { stroke-dasharray: 1; stroke-dashoffset: 1; }
            to { stroke-dasharray: 1; stroke-dashoffset: 0; }
          }
        `}</style>
      </svg>

      {overlay && <PriceTags overlay={overlay} domain={domain} />}

      {axisTicks.length > 0 && (
        <div className="relative mt-1 h-4 text-[10px] text-panda-grey">
          {axisTicks.map((tick, i) => (
            <span
              key={i}
              className={`absolute whitespace-nowrap ${
                i === 0 ? "" : i === axisTicks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
              }`}
              style={{ left: `${(tick.x / width) * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
