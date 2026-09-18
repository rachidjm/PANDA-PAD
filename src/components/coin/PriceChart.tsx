"use client";

import { useRef, useState } from "react";
import { formatPct, formatPrice } from "@/lib/format";

const timeframes = ["5m", "1h", "4h", "1d"] as const;
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
  const [tf, setTf] = useState<Timeframe>("1h");
  const [closes, setCloses] = useState<number[]>(initialCloses);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  function selectTimeframe(next: Timeframe) {
    setTf(next);
    if (!poolAddress || next === tf) return;

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
          {timeframes.map((t) => (
            <button
              key={t}
              onClick={() => selectTimeframe(t)}
              disabled={!poolAddress}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase transition-colors disabled:opacity-40 ${
                tf === t ? "bg-paper text-ink" : "text-panda-grey hover:text-paper/80"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-6 transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        <AreaChart data={closes} positive={positive} />
      </div>

      {closes.length > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-panda-grey">
          <span>Low {formatPrice(low)}</span>
          <span>High {formatPrice(high)}</span>
        </div>
      )}
    </div>
  );
}

function AreaChart({ data, positive }: { data: number[]; positive: boolean }) {
  const width = 720;
  const height = 260;
  const padding = 8;

  if (data.length < 2) {
    return <div className="flex h-[260px] items-center justify-center text-sm text-panda-grey">No chart data yet</div>;
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

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${height - padding} L${points[0].x.toFixed(1)},${height - padding} Z`;
  const gradientId = `chart-fill-${positive ? "up" : "down"}`;

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
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
