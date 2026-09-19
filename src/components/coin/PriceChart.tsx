"use client";

import { useEffect, useRef, useState } from "react";
import { formatPct, formatPrice } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const timeframes = ["1m", "5m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof timeframes)[number];

type Candle = { time: number; close: number };

export default function PriceChart({
  poolAddress,
  initialCloses,
  changePct,
}: {
  poolAddress?: string;
  initialCloses: number[];
  changePct: number;
}) {
  const { t } = useLanguage();
  // Minute candles by default — the richest, most "alive" view of a coin
  // that's actually trading. `initialCloses` (server-rendered) is hourly, so
  // this fires once on mount to swap in real 1-minute data right away.
  const [tf, setTf] = useState<Timeframe>("1m");
  const [closes, setCloses] = useState<number[]>(initialCloses);
  const [loading, setLoading] = useState(false);
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
        const points = (data.candles || []).map((c) => c.close);
        if (points.length > 1) setCloses(points);
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
    if (!poolAddress || next === tf) return;
    loadTimeframe(next);
  }

  const price = closes[closes.length - 1] ?? 0;
  const windowChangePct = closes.length > 1 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : changePct;
  const positive = windowChangePct >= 0;
  const low = Math.min(...closes);
  const high = Math.max(...closes);

  return (
    <div className="rounded-[26px] border border-paper/10 bg-ink-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-bold sm:text-3xl">{formatPrice(price)}</p>
          <p className={`text-sm font-semibold ${positive ? "text-bamboo" : "text-clay-red"}`}>
            {formatPct(windowChangePct)} <span className="text-panda-grey font-normal">· {tf.toUpperCase()}</span>
          </p>
        </div>
        <div className="flex gap-1 rounded-full bg-ink p-1">
          {timeframes.map((tfOption) => (
            <button
              key={tfOption}
              onClick={() => selectTimeframe(tfOption)}
              disabled={!poolAddress}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase transition-colors disabled:opacity-40 ${
                tf === tfOption ? "bg-paper text-ink" : "text-panda-grey hover:text-paper/80"
              }`}
            >
              {tfOption}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-6 transition-opacity duration-500 ${loading ? "opacity-40" : "opacity-100"}`}>
        <AreaChart data={closes} positive={positive} noDataLabel={t("chart.noData")} />
      </div>

      {closes.length > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-panda-grey">
          <span>{t("chart.low", { value: formatPrice(low) })}</span>
          <span>{t("chart.high", { value: formatPrice(high) })}</span>
        </div>
      )}
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

function AreaChart({ data, positive, noDataLabel }: { data: number[]; positive: boolean; noDataLabel: string }) {
  const width = 720;
  const height = 260;
  const padding = 8;

  if (data.length < 2) {
    return <div className="flex h-[260px] items-center justify-center text-sm text-panda-grey">{noDataLabel}</div>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = (width - padding * 2) / (data.length - 1);
  const color = positive ? "var(--bamboo)" : "var(--clay-red)";

  const points = data.map((v, i) => {
    const x = padding + i * step;
    const y = padding + (height - padding * 2) * (1 - (v - min) / range);
    return { x, y };
  });

  const line = smoothPath(points);
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${height - padding} L${points[0].x.toFixed(1)},${height - padding} Z`;
  const gradientId = `chart-fill-${positive ? "up" : "down"}`;
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
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
      <circle cx={last.x} cy={last.y} r={4} fill={color}>
        <animate attributeName="r" values="4;7;4" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <style>{`
        @keyframes panda-chart-draw {
          from { stroke-dasharray: 1; stroke-dashoffset: 1; }
          to { stroke-dasharray: 1; stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  );
}
