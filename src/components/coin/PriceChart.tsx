"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatPct, formatPrice, formatCompact } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { Coin } from "@/lib/types";
import { CHART, clampDomain, clientYToChartY, fitDomain, priceToY, rowToAnchor, sameDomain, wheelFactor, yToPrice, zoomDomain, zoomLimits, type Domain } from "@/lib/strategy/scale";
import { useDrawTrade } from "@/components/coin/draw/useDrawTrade";
import DrawTradePanel from "@/components/coin/draw/DrawTradePanel";
import { PriceTags, StrategyLines, type ChartOverlayData } from "@/components/coin/draw/ChartOverlay";
import { TradeMarkerDots, TradeMarkerTooltip, type PandaExecutions } from "@/components/coin/TradeMarkers";
import { useCurrency } from "@/components/portfolio/useCurrency";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import { useRegisterDrawTradeForAI } from "@/components/ai/DrawTradeAIBridge";

// Shortest to longest, each requesting its own genuinely correctly-sized range from /api/chart — see that
// route's own comment for the bug this replaced (a "1 day" tab that silently pulled 30 days of daily candles).
const timeframes = ["1m", "5m", "1h", "4h", "1d", "1w", "30d"] as const;
type Timeframe = (typeof timeframes)[number];
type Unit = "price" | "mcap";

type Candle = { time: number; close: number };

const UNIT_KEY = "panda.chart.unit";

function tfLabel(tfOption: Timeframe, weekLabel: string): string {
  switch (tfOption) {
    case "1d":
      return "1D";
    case "1w":
      return weekLabel; // "1S" / "1W" — the only one whose short form differs by language
    case "30d":
      return "30D";
    default:
      return tfOption; // "1m" / "5m" / "1h" / "4h" — already exactly right, lowercase
  }
}

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
  const { t, lang } = useLanguage();
  // Minute candles by default — the richest, most "alive" view of a coin
  // that's actually trading. `initialCloses` (server-rendered) is hourly and
  // has no real per-point timestamps, so this fires once on mount to swap in
  // real, timestamped 1-minute data right away.
  const [tf, setTf] = useState<Timeframe>("1m");
  // Cached per timeframe, so flipping between tabs doesn't re-hit GeckoTerminal's own (tight) rate limit every
  // time, and — just as important — a failed fetch for one tab can never silently leave another tab's stale
  // candles on screen under the wrong label (each tf only ever shows its OWN cached data, or a clear "couldn't
  // load" state, never someone else's).
  const [byTf, setByTf] = useState<Partial<Record<Timeframe, Candle[]>>>({});
  // "error" = the request itself failed (network, non-200) — worth a retry button. "empty" = a real, successful
  // response with fewer than 2 candles — not a failure, just no history yet (see the "too young" check below,
  // which turns this into a calm "available soon" message instead of an alarming error for a brand-new coin).
  const [failedTf, setFailedTf] = useState<Partial<Record<Timeframe, "error" | "empty">>>({});
  const [loading, setLoading] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(false);

  // Price vs market cap — remembered across visits. The server (and the first paint) always assume "price",
  // corrected a moment after mount (same hydration-safe pattern as useCurrency.ts: never read localStorage in
  // a useState initializer, or the server/client markup can disagree).
  const [unit, setUnit] = useState<Unit>("price");
  // Snapshot once at mount (a lazy initializer, not a render-time call) — only used for a coarse "is this coin
  // brand new" check below, so it never needs to re-read the clock on every render.
  const [mountedAtMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(UNIT_KEY);
        if (saved === "price" || saved === "mcap") setUnit(saved);
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  function pickUnit(u: Unit) {
    setUnit(u);
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {}
  }

  // Your own buys/sells of this coin, marked on the chart — only with a connected wallet. Real PANDA trades
  // AND real on-chain history outside PANDA (the same backfill /portfolio uses) — see /api/portfolio/trades.
  const { connected, publicKey } = useWallet();
  const { currency, eurUsd } = useCurrency(lang);
  const [myTrades, setMyTrades] = useState<LoggedTrade[]>([]);
  const [hoveredTradeKey, setHoveredTradeKey] = useState<string | null>(null);
  // Bumped when a PANDA order of this wallet has executed and isn't among the trades read so far (see below).
  const [tradesVersion, setTradesVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!connected || !publicKey || !coin) {
      Promise.resolve().then(() => {
        if (!cancelled) setMyTrades([]);
      });
      return () => {
        cancelled = true;
      };
    }
    fetch(`/api/portfolio/trades?wallet=${publicKey.toBase58()}&mint=${coin.mint}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("trades"))))
      .then((d: { trades?: LoggedTrade[] }) => {
        if (!cancelled) setMyTrades(d.trades || []);
      })
      .catch(() => {
        if (!cancelled) setMyTrades([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, coin, tradesVersion]);

  function loadTimeframe(next: Timeframe) {
    if (!poolAddress || byTf[next]) return;
    const id = ++requestId.current;
    setLoading(true);
    fetch(`/api/chart?pool=${poolAddress}&tf=${next}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { candles?: Candle[] }) => {
        if (requestId.current !== id) return;
        const points = data.candles || [];
        if (points.length > 1) {
          setByTf((m) => ({ ...m, [next]: points }));
        } else {
          setFailedTf((m) => ({ ...m, [next]: "empty" }));
        }
      })
      .catch(() => {
        if (requestId.current === id) setFailedTf((m) => ({ ...m, [next]: "error" }));
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
    loadTimeframe(next);
  }

  /** A failed load leaves `byTf[tf]` unset, so simply asking again (loadTimeframe no-ops only when it already
   *  has real data) retries it — no special-cased "clear the failure" step needed. */
  function retryTimeframe() {
    loadTimeframe(tf);
  }

  const hasRealTimes = !!byTf[tf];
  const candles = byTf[tf] ?? (tf === "1m" ? initialCloses.map((close) => ({ time: 0, close })) : []);
  const reason = byTf[tf] ? undefined : failedTf[tf];
  // A coin this young genuinely cannot have real chart history yet (indexers take real time to pick up a
  // brand-new pool) — an empty response here is expected, not a problem, so it gets a calm "available soon"
  // message instead of the same alarming "couldn't load" state as a genuine fetch failure.
  const coinAgeMs = coin ? mountedAtMs - new Date(coin.createdAt).getTime() : undefined;
  const tooYoungForData = reason === "empty" && coinAgeMs !== undefined && coinAgeMs < 6 * 3_600_000;
  const failed = reason === "error" || (reason === "empty" && !tooYoungForData);

  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1] ?? 0;
  // Constant-supply ratio, anchored to the real current price/market cap this
  // page loaded with — not refetched per candle, since none of GeckoTerminal,
  // Dexscreener, or the OHLCV endpoint expose a market-cap history.
  const supply = marketCap && lastClose > 0 ? marketCap / lastClose : undefined;

  const toDisplay = useCallback((usd: number) => (unit === "mcap" && supply ? usd * supply : usd), [unit, supply]);
  const fromDisplay = useCallback((v: number) => (unit === "mcap" && supply ? v / supply : v), [unit, supply]);
  const formatValue = useCallback((usd: number) => (unit === "mcap" ? formatCompact(toDisplay(usd)) : formatPrice(toDisplay(usd))), [unit, toDisplay]);

  const draw = useDrawTrade(coin ?? null, lastClose);
  const overlay: ChartOverlayData | undefined = coin
    ? {
        lines: draw.lines,
        drawing: draw.machine.target,
        drawingHeld: !draw.current?.buy,
        preview: draw.machine.preview,
        onPointer: draw.onPointer,
        labels: (k) => (k === "buy" ? t("draw.line.buy") : k === "stop" ? t("draw.line.stop") : t("draw.line.sell")),
        previewLabels: (k) => (k === "buy" ? t("draw.line.buyTarget") : k === "stop" ? t("draw.line.stopTarget") : t("draw.line.sellTarget")),
        toDisplay,
        fromDisplay,
        formatValue,
        grabLine: (line, price, info) => {
          if (!line.lineId) return;
          if (line.order) return draw.startOrderDrag(line.order, price, info);
          draw.startTrancheDrag(line.groupId, line.lineId, line.kind === "stop" ? "stop" : "sell", price, info);
        },
      }
    : undefined;

  // An executed PANDA order is a real sell: the server logs it with the wallet's other trades (from its own transaction),
  // and here it is drawn with its own mark — green "V" for a sell, red "S" for a stop. If one executed since the trades
  // were read, they are read again (a couple of times at most: the log is written when the order list is asked for).
  const pandaExecutions = draw.pandaExecutions;
  const missingExecution = [...pandaExecutions.keys()].some((sig) => !myTrades.some((tr) => tr.signature === sig));
  useEffect(() => {
    if (!missingExecution || tradesVersion >= 3) return;
    const timer = setTimeout(() => setTradesVersion((n) => n + 1), tradesVersion === 0 ? 0 : 4000);
    return () => clearTimeout(timer);
  }, [missingExecution, tradesVersion, pandaExecutions]);

  // Lets the AI Assistant's "Ayuda con Draw Your Trade" panel (opened from anywhere) reach THIS coin's own
  // live draw controller — see src/components/ai/DrawTradeAIBridge.tsx.
  useRegisterDrawTradeForAI(draw, coin?.mint ?? "", coin?.ticker ?? "", draw.currentUsd);

  const shown = hoverIndex !== null ? hoverIndex : closes.length - 1;
  // The headline "right now" price never depends on the chart alone — a real, independent live price
  // (coin.livePriceUsd, from Jupiter's Price API or Dexscreener — see enrichCoinDetail) wins whenever one's
  // available and nothing is being hovered. Hovering a specific point on the chart always shows THAT point's
  // own historical close, which is correctly chart-derived. undefined (never 0) means no price at all —
  // every reader below falls back to "—", not a fabricated dollar amount.
  const shownPrice: number | undefined = hoverIndex === null && coin?.livePriceUsd !== undefined ? coin.livePriceUsd : closes[shown];
  const shownMarketCap = supply !== undefined && shownPrice !== undefined ? shownPrice * supply : undefined;
  const shownTime = hasRealTimes ? candles[shown]?.time : undefined;

  const windowChangePct = closes.length > 1 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : changePct;
  const positive = windowChangePct >= 0;
  const displayCloses = closes.map(toDisplay);
  const low = displayCloses.length ? Math.min(...displayCloses) : 0;
  const high = displayCloses.length ? Math.max(...displayCloses) : 0;
  const fmtDisplay = (n: number) => (unit === "mcap" ? formatCompact(n) : formatPrice(n));

  const bigValue = unit === "mcap" ? (shownMarketCap !== undefined ? formatCompact(shownMarketCap) : "—") : shownPrice !== undefined ? formatPrice(shownPrice) : "—";
  const otherLabel = unit === "mcap" ? t("chart.price") : t("chart.mc");
  const otherValue = unit === "mcap" ? (shownPrice !== undefined ? formatPrice(shownPrice) : null) : shownMarketCap !== undefined ? formatCompact(shownMarketCap) : null;

  return (
    <div className="rounded-[26px] border border-paper/10 bg-ink-raised p-4 sm:p-6">
      {/* flex-col on mobile (two clean stacked rows, never fighting for width) / flex-row on desktop with the
          timeframe pill pinned to shrink-0 — so neither box ever resizes or reflows when the price info's own
          width changes on hover (see the fixed-height stat block below). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {marketCap !== undefined && (
            <div className="mb-1.5 flex w-max gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={`${t("chart.price")} / ${t("chart.mc")}`}>
              {(["price", "mcap"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => pickUnit(u)}
                  aria-pressed={unit === u}
                  className={`min-h-11 min-w-[64px] rounded-full px-2.5 py-1 text-center text-[11px] font-semibold transition-colors sm:min-h-0 ${unit === u ? "bg-paper text-ink" : "text-panda-grey hover:text-paper/80"}`}
                >
                  {u === "price" ? t("chart.price") : t("chart.mc")}
                </button>
              ))}
            </div>
          )}
          <p className="font-display text-2xl font-bold tabular-nums sm:text-3xl">{bigValue}</p>
          <p className={`text-sm font-semibold tabular-nums ${positive ? "text-bamboo" : "text-clay-red"}`}>
            {formatPct(windowChangePct)} <span className="text-panda-grey font-normal">· {tfLabel(tf, t("chart.tf.week"))}</span>
          </p>
          {/* Always one line, always present when there's a second unit to show — only the trailing date
              (added on hover) is allowed to change, and it never wraps or grows the row: it truncates
              instead, so the header's height and the timeframe pill's box never move. */}
          {otherValue !== null && (
            <p className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap text-xs text-panda-grey">
              <span className="tabular-nums">
                {otherLabel}: <span className="font-medium text-paper/80">{otherValue}</span>
              </span>
              <span className="overflow-hidden text-ellipsis tabular-nums">{hoverIndex !== null && shownTime ? `· ${formatAxisTime(shownTime, tickIncludesDate(tf, candles), true)}` : ""}</span>
            </p>
          )}
        </div>
        {/* Narrow screens (a phone, Telegram's Mini App): one row of equal columns across the whole width — never wrapped
            into two ragged lines. From the tablet up: a pill hugging its buttons, on the right. */}
        <div className="grid w-full shrink-0 gap-0.5 rounded-full bg-ink p-1 sm:flex sm:w-auto sm:gap-1" style={{ gridTemplateColumns: `repeat(${timeframes.length}, minmax(0, 1fr))` }}>
          {timeframes.map((tfOption) => (
            <button
              key={tfOption}
              onClick={() => selectTimeframe(tfOption)}
              disabled={!poolAddress}
              className={`min-h-10 min-w-0 whitespace-nowrap rounded-full px-0 py-1 text-center text-xs font-semibold transition-colors disabled:opacity-40 sm:min-h-0 sm:min-w-[38px] sm:px-3 sm:py-1.5 ${
                tf === tfOption ? "bg-paper text-ink" : "text-panda-grey hover:text-paper/80"
              }`}
            >
              {tfLabel(tfOption, t("chart.tf.week"))}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-4 transition-opacity duration-500 sm:mt-6 ${loading ? "opacity-40" : "opacity-100"}`}>
        {tooYoungForData ? (
          <div className="flex h-[170px] flex-col items-center justify-center gap-1 text-sm text-panda-grey sm:h-[260px]">
            <p>{t("chart.tooYoung")}</p>
            <p className="text-xs text-panda-grey/70">{t("chart.tooYoung.hint")}</p>
          </div>
        ) : failed ? (
          <div className="flex h-[170px] flex-col items-center justify-center gap-2 text-sm text-panda-grey sm:h-[260px]">
            <p>{t("chart.loadError")}</p>
            <button type="button" onClick={retryTimeframe} className="rounded-full bg-paper/10 px-3 py-1.5 text-xs font-semibold text-paper hover:bg-paper/15">
              {t("chart.retry")}
            </button>
          </div>
        ) : (
          <AreaChart
            candles={candles}
            positive={positive}
            noDataLabel={t("chart.noData")}
            hasRealTimes={hasRealTimes}
            tf={tf}
            hoverIndex={hoverIndex}
            onHover={setHoverIndex}
            formatAxis={fmtDisplay}
            viewKey={`${tf}:${unit}`}
            now={draw.currentUsd !== null ? toDisplay(draw.currentUsd) : lastClose > 0 ? toDisplay(lastClose) : null}
            resetLabel={t("chart.resetView")}
            overlay={overlay}
            myTrades={hasRealTimes ? myTrades : []}
            pandaExecutions={pandaExecutions}
            hoveredTradeKey={hoveredTradeKey}
            onHoverTrade={setHoveredTradeKey}
            currency={currency}
            eurUsd={eurUsd}
            toDisplay={toDisplay}
            fromDisplay={fromDisplay}
          />
        )}
      </div>

      {!failed && closes.length > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs tabular-nums text-panda-grey">
          <span>{t("chart.low", { value: fmtDisplay(low) })}</span>
          <span>{t("chart.high", { value: fmtDisplay(high) })}</span>
        </div>
      )}

      {coin && <DrawTradePanel draw={draw} coin={coin} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} formatValue={formatValue} />}
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

/** Whether the axis/hover labels for this tab should carry a date, not just a time. The 1w/30d tabs
 *  always do; any other tab does too when its real candles happen to span more than a day (see
 *  formatAxisTime below for why that can happen even on the "1 minute" tab). */
function tickIncludesDate(tf: Timeframe, candles: Candle[]): boolean {
  if (tf === "1w" || tf === "30d") return true;
  if (candles.length < 2) return false;
  const spanSeconds = candles[candles.length - 1].time - candles[0].time;
  return spanSeconds >= 20 * 3600;
}

/** `includeDate`: the 1w/30d tabs always show a date, and so does ANY timeframe when its real candles
 *  happen to span more than a day — a thinly-traded coin can get "1-minute" candles that are actually
 *  hours or days apart (GeckoTerminal only has a candle where a real trade happened), and hour:minute
 *  alone would look out of order across midnight. `real` additionally picks the fuller "day, HH:MM"
 *  format for the small inline hover caption; the x-axis ticks themselves stay short. */
function formatAxisTime(epochSeconds: number, includeDate: boolean, real = false): string {
  const d = new Date(epochSeconds * 1000);
  if (includeDate && !real) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!real) return time;
  if (!includeDate) return time;
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
  myTrades,
  pandaExecutions,
  hoveredTradeKey,
  onHoverTrade,
  currency,
  eurUsd,
  toDisplay,
  fromDisplay,
  formatAxis,
  resetLabel,
  viewKey,
  now,
}: {
  /** Which view this is (timeframe and unit): a zoom belongs to one, and another starts from the normal view. */
  viewKey: string;
  /** The current price, in the axis's own unit — what the normal view is fitted around and the zoom's limits are measured from. */
  now: number | null;
  overlay?: ChartOverlayData;
  /** How a value of the Y axis is written (price or market cap) — for the two small range labels of a moved view. */
  formatAxis: (displayValue: number) => string;
  resetLabel: string;
  candles: Candle[];
  positive: boolean;
  noDataLabel: string;
  hasRealTimes: boolean;
  tf: Timeframe;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  myTrades: LoggedTrade[];
  pandaExecutions: PandaExecutions;
  hoveredTradeKey: string | null;
  onHoverTrade: (key: string | null) => void;
  currency: import("@/lib/format").Currency;
  eurUsd: number | null;
  /** Real USD ↔ whatever's on the Y axis right now (price or market cap) — see PriceChart.tsx. */
  toDisplay: (usd: number) => number;
  fromDisplay: (displayValue: number) => number;
}) {
  const { width, height, padding } = CHART;
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgHeight, setSvgHeight] = useState<number>(height);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => setSvgHeight(el.clientHeight || height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);
  const data = candles.map((c) => toDisplay(c.close));

  // The normal view: around the candles, the current price and the lines already drawn, with room above and below to
  // mark new ones wherever Draw Your Trade is available (the same room whether or not a line is being placed, so the
  // scale doesn't jump when drawing starts). Computed even with too little data to draw a curve, so every hook below
  // always runs in the same order.
  const drawing = !!overlay?.drawing;
  const marks = overlay ? overlay.lines.map((l) => toDisplay(l.price)) : [];
  const fit = fitDomain(data, marks, overlay ? 0.25 : 0, now);
  const limits = zoomLimits(fit, now);

  // A drag is tracked on `window` from "down" until "up" / "cancel" (see below): the pointer that is placing a line.
  const [dragPointerId, setDragPointerId] = useState<number | null>(null);

  // The user's zoom of the price axis — vertical only, within `limits` (never below a tenth of the current price, never
  // above ten times it, never to zero). It belongs to one view (timeframe + unit). Everything below — the curve, the
  // lines, their tags, the price under the pointer — reads `domain`, so they all follow it together.
  const [zoom, setZoom] = useState<{ key: string; domain: Domain } | null>(null);
  const zoomed = zoom && zoom.key === viewKey ? clampDomain(zoom.domain, limits) : null;
  const domain = zoomed && !sameDomain(zoomed, fit) ? zoomed : fit;
  const moved = domain !== fit;
  // The view the next zoom step starts from: the one on screen, or — when several wheel / pinch events arrive before
  // the chart is drawn again — the one the previous step just made, so no step is ever lost.
  const latest = useRef<{ key: string; domain: Domain } | null>(null);
  useEffect(() => {
    latest.current = { key: viewKey, domain };
  });
  const zoomBy = (factor: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const from = latest.current?.key === viewKey ? latest.current.domain : domain;
    const next = zoomDomain(from, factor, rowToAnchor(clientYToChartY(clientY, rect.top, rect.height)), limits);
    latest.current = { key: viewKey, domain: next };
    setZoom(sameDomain(next, fit) ? null : { key: viewKey, domain: next });
  };

  // Mouse wheel, only while the pointer is ON the chart: a non-passive listener there, so the page doesn't scroll under
  // it; anywhere else the wheel scrolls the page as always.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    const el = svgRef.current;
    if (!el || e.ctrlKey) return; // ctrl + wheel is the browser's own page zoom
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.getBoundingClientRect().height : e.deltaY;
    zoomBy(wheelFactor(delta), e.clientY);
  });

  // Two fingers: pinch. One finger is never taken for the zoom — it draws and drags lines, reads the chart, and
  // scrolls the page. The pinch is read from the touches themselves, so it works while the chart lets the page scroll.
  const pinch = useRef<{ dist: number } | null>(null);
  const [pinching, setPinching] = useState(false);
  const dropLine = useEffectEvent(() => {
    // A line that the first finger was placing is dropped, not committed, when the second one lands.
    if (overlay?.drawing && dragPointerId !== null) {
      overlay.onPointer("leave", 0, { type: "touch", button: 0, pressed: false });
      setDragPointerId(null);
    }
    onHover(null);
  });
  const onTouch = useEffectEvent((e: TouchEvent) => {
    if (e.touches.length !== 2) {
      if (pinch.current) {
        pinch.current = null;
        setPinching(false);
      }
      return;
    }
    e.preventDefault(); // two fingers on the chart are the chart's: no page zoom, no scroll
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.max(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), 1);
    if (!pinch.current) {
      pinch.current = { dist };
      setPinching(true);
      dropLine();
      return;
    }
    // Fingers apart = closer (fewer prices on screen). Small steps: the movement since the last event only.
    const factor = Math.max(0.8, Math.min(1.25, pinch.current.dist / dist));
    pinch.current = { dist };
    zoomBy(factor, (a.clientY + b.clientY) / 2);
  });

  // With fewer than two candles no chart is rendered at all: the listeners are attached when one appears.
  const noChart = data.length < 2;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => onWheel(e);
    const touch = (e: TouchEvent) => onTouch(e);
    el.addEventListener("wheel", wheel, { passive: false });
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) el.addEventListener(type, touch, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) el.removeEventListener(type, touch);
    };
  }, [noChart]);

  /** The price at a given screen Y, from the chart's own scale (the same one that draws the curve) — always
   *  converted back to a real USD price before it leaves this function, since that's the space every strategy
   *  line and the drag machine itself work in. */
  function priceAtClientY(clientY: number): number {
    const rect = svgRef.current!.getBoundingClientRect();
    return fromDisplay(yToPrice(clientYToChartY(clientY, rect.top, rect.height), domain));
  }
  function priceAt(e: React.PointerEvent<SVGSVGElement>): number {
    return priceAtClientY(e.clientY);
  }
  const info = (e: React.PointerEvent<SVGSVGElement>) => ({ type: e.pointerType, button: e.button, pressed: e.buttons > 0 });

  // A short (170px on a phone) chart is easy to drag a finger above or below while placing a
  // price near the top/bottom of the range — once that happens the pointer is no longer over
  // the SVG. Tracking the drag on `window` instead of the SVG itself (from "down" until "up"/
  // "cancel") means the line keeps following the finger and still commits on release, wherever
  // the finger ends up, instead of silently going stale the moment it leaves the chart's bounds.
  useEffect(() => {
    if (!drawing || dragPointerId === null) return;
    const isTracked = (e: PointerEvent) => e.pointerId === dragPointerId;
    const onMove = (e: PointerEvent) => {
      if (!isTracked(e)) return;
      // A touch pointermove only ever fires while the finger is still down.
      overlay!.onPointer("move", priceAtClientY(e.clientY), { type: e.pointerType, button: e.button, pressed: e.pointerType === "touch" || e.buttons > 0 });
    };
    const onUp = (e: PointerEvent) => {
      if (!isTracked(e)) return;
      overlay!.onPointer("up", priceAtClientY(e.clientY), { type: e.pointerType, button: e.button, pressed: false });
      setDragPointerId(null);
    };
    const onCancel = (e: PointerEvent) => {
      if (!isTracked(e)) return;
      overlay!.onPointer("leave", 0, { type: e.pointerType, button: 0, pressed: false });
      setDragPointerId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, dragPointerId]);

  if (data.length < 2) {
    return <div className="flex h-[170px] items-center justify-center text-sm text-panda-grey sm:h-[260px]">{noDataLabel}</div>;
  }

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

  function hoverIndexAt(e: React.PointerEvent<SVGSVGElement>): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(relX * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, idx));
  }

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current || pinching) return;
    if (drawing) {
      // While a drag is being tracked on `window` (above), that's the single source of truth — this
      // would otherwise double-fire for the same movement whenever the pointer is still over the SVG.
      if (dragPointerId === null) overlay!.onPointer("move", priceAt(e), info(e));
      return;
    }
    onHover(hoverIndexAt(e));
  }

  // Up to 5 evenly-spaced real timestamps along the bottom, so the timeline
  // itself is visible, not just implied by the curve's shape.
  const axisIncludesDate = tickIncludesDate(tf, candles);
  const axisTicks =
    hasRealTimes && candles.length > 1
      ? [0, 0.25, 0.5, 0.75, 1].map((f) => {
          const idx = Math.round(f * (candles.length - 1));
          return { x: points[idx].x, label: formatAxisTime(candles[idx].time, axisIncludesDate) };
        })
      : [];

  return (
    <div className="relative" data-tutorial="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerLeave={() => {
          // Once a drag is being tracked (above), leaving the SVG's own bounds is expected and must not cancel it.
          if (drawing) { if (dragPointerId === null) overlay!.onPointer("leave", 0, { type: "mouse", button: 0, pressed: false }); }
          else onHover(null);
        }}
        onPointerDown={(e) => {
          if (pinching || (e.pointerType === "mouse" && e.button !== 0)) return;
          if (drawing) {
            setDragPointerId(e.pointerId);
            overlay!.onPointer("down", priceAt(e), info(e));
            return;
          }
          // Touch: show the point under the finger right away.
          if (e.pointerType === "touch") onHover(hoverIndexAt(e));
        }}
        onPointerUp={(e) => {
          if (!drawing && e.pointerType === "touch") onHover(null);
        }}
        onPointerCancel={(e) => {
          if (!drawing && e.pointerType === "touch") onHover(null);
        }}
        className="h-[170px] w-full cursor-crosshair sm:h-[260px]"
        style={{
          // While a line is being placed, one finger on the chart belongs to the line. Otherwise the page scrolls
          // through the chart as through anything else (two fingers pinch — handled above).
          touchAction: drawing ? "none" : "pan-y",
          WebkitTapHighlightColor: "transparent",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
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
          style={{ animation: "chartline-draw-in 900ms ease-out" }}
        />

        {overlay && <StrategyLines overlay={overlay} domain={domain} />}

        {myTrades.length > 0 && <TradeMarkerDots trades={myTrades} candles={candles} domain={domain} hoveredKey={hoveredTradeKey} onHover={onHoverTrade} panda={pandaExecutions} toDisplay={toDisplay} />}

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
          @keyframes chartline-draw-in {
            from { stroke-dasharray: 1; stroke-dashoffset: 1; }
            to { stroke-dasharray: 1; stroke-dashoffset: 0; }
          }
        `}</style>
      </svg>

      {moved && (
        <>
          {/* A zoomed view says what it shows (top and bottom of the axis) and has one small way back, in the corner. */}
          <span className="pointer-events-none absolute left-1.5 top-1 rounded bg-ink/70 px-1 text-[10px] tabular-nums text-panda-grey">{formatAxis(domain.max)}</span>
          <span className="pointer-events-none absolute left-1.5 rounded bg-ink/70 px-1 text-[10px] tabular-nums text-panda-grey" style={{ top: svgHeight - 18 }}>
            {formatAxis(domain.min)}
          </span>
          <button
            type="button"
            onClick={() => setZoom(null)}
            className="absolute right-1.5 top-1 inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full border border-paper/15 bg-ink/85 px-2 text-[10px] font-semibold text-paper/80 backdrop-blur transition-colors hover:text-paper"
          >
            <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.2 6a3.8 3.8 0 1 0 1.2-2.8M2 1.8v2h2" />
            </svg>
            {resetLabel}
          </button>
        </>
      )}

      {overlay && <PriceTags overlay={overlay} domain={domain} priceAtClientY={priceAtClientY} onGrabPointer={setDragPointerId} />}
      {myTrades.length > 0 && (
        <TradeMarkerTooltip trades={myTrades} candles={candles} domain={domain} hoveredKey={hoveredTradeKey} panda={pandaExecutions} currency={currency} eurUsd={eurUsd} boxHeight={svgHeight} toDisplay={toDisplay} />
      )}

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
