"use client";

import { useMemo } from "react";
import { CHART, clampedY, type Domain } from "@/lib/strategy/scale";
import { formatMoney, type Currency } from "@/lib/format";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { EdgeArrow } from "@/components/coin/draw/ChartOverlay";

/** Real USD price per token at the moment of the trade — the same figures the trade was logged with (see
 *  src/lib/portfolio/trade-log.ts), never re-estimated. */
export function tradePriceUsd(t: LoggedTrade): number {
  return t.tokenAmount > 0 ? (t.solAmount * t.solPriceUsdAtTrade) / t.tokenAmount : 0;
}

type Mark = { trade: LoggedTrade; x: number; y: number; out: "above" | "below" | null };

/** Places each trade at its real timestamp's nearest candle, and its real price converted to whatever the Y
 *  axis is showing right now (`toDisplay` — price or market cap; see PriceChart.tsx). A trade whose price
 *  sits outside the currently visible range never stretches the scale to fit it: it clamps to the top/bottom
 *  edge instead (`out`), drawn as a small arrow rather than a dot — see TradeMarkerDots. Only for trades that
 *  fall inside the currently displayed candle WINDOW (time); a trade from a different timeframe entirely
 *  simply isn't shown, rather than guessed at the edge of the chart. */
function useTradeMarks(trades: LoggedTrade[], candles: { time: number; close: number }[], domain: Domain, toDisplay: (usd: number) => number): Mark[] {
  return useMemo(() => {
    if (candles.length < 2) return [];
    const { width, padding } = CHART;
    const step = (width - padding * 2) / (candles.length - 1);
    const first = candles[0].time;
    const last = candles[candles.length - 1].time;
    const marks: Mark[] = [];
    for (const t of trades) {
      const ts = Math.round(t.ts / 1000);
      if (ts < first || ts > last) continue;
      let nearest = 0;
      let best = Infinity;
      for (let k = 0; k < candles.length; k++) {
        const d = Math.abs(candles[k].time - ts);
        if (d < best) {
          best = d;
          nearest = k;
        }
      }
      const { y, out } = clampedY(toDisplay(tradePriceUsd(t)), domain);
      marks.push({ trade: t, x: padding + nearest * step, y, out });
    }
    return marks;
  }, [trades, candles, domain, toDisplay]);
}

const COLOR = { buy: "var(--bamboo)", sell: "var(--clay-red)" };

/** The dots themselves — rendered INSIDE the chart's own <svg> (same coordinate space as the price curve). */
export function TradeMarkerDots({
  trades,
  candles,
  domain,
  hoveredKey,
  onHover,
  toDisplay = (usd) => usd,
}: {
  trades: LoggedTrade[];
  candles: { time: number; close: number }[];
  domain: Domain;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  /** Converts a real USD price into whatever the Y axis is showing (price or market cap) — see PriceChart.tsx. */
  toDisplay?: (usd: number) => number;
}) {
  const marks = useTradeMarks(trades, candles, domain, toDisplay);
  if (marks.length === 0) return null;
  return (
    <g>
      {marks.map(({ trade, x, y, out }) => {
        const active = hoveredKey === trade.signature;
        return (
          <g
            key={trade.signature}
            onPointerEnter={() => onHover(trade.signature)}
            onPointerLeave={() => onHover(null)}
            onClick={() => onHover(active ? null : trade.signature)} // tap-to-toggle: touch devices don't reliably fire pointerenter/leave
            style={{ cursor: "pointer" }}
          >
            {/* An invisible, larger hit target — the visible dot/arrow alone is too small to reliably tap. */}
            <circle cx={x} cy={y} r={12} fill="transparent" />
            {out ? (
              <EdgeArrow x={x} y={y} out={out} color={COLOR[trade.side]} />
            ) : (
              <>
                <circle cx={x} cy={y} r={active ? 8 : 6} fill={COLOR[trade.side]} stroke="var(--ink)" strokeWidth={1.5} />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={active ? 8 : 7} fontWeight={800} fill="var(--ink)" pointerEvents="none">
                  {trade.side === "buy" ? "C" : "V"}
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** The tooltip for whichever mark is hovered/tapped — HTML, positioned over the SVG (same scaling trick as PriceTags). */
export function TradeMarkerTooltip({
  trades,
  candles,
  domain,
  hoveredKey,
  currency,
  eurUsd,
  boxHeight,
  toDisplay = (usd) => usd,
}: {
  trades: LoggedTrade[];
  candles: { time: number; close: number }[];
  domain: Domain;
  hoveredKey: string | null;
  currency: Currency;
  eurUsd: number | null;
  /** The <svg>'s real rendered height in CSS pixels (170 on a phone, 260 on desktop) — scales CHART's own coordinate space to it. */
  boxHeight: number;
  toDisplay?: (usd: number) => number;
}) {
  const { t, lang } = useLanguage();
  const marks = useTradeMarks(trades, candles, domain, toDisplay);
  const mark = marks.find((m) => m.trade.signature === hoveredKey);
  if (!mark) return null;

  const usd = mark.trade.solAmount * mark.trade.solPriceUsdAtTrade;
  const amount = currency === "EUR" && eurUsd === null ? "…" : formatMoney(currency === "EUR" ? usd / (eurUsd as number) : usd, currency, lang);
  const qty = mark.trade.tokenAmount.toLocaleString(lang, { maximumFractionDigits: mark.trade.tokenAmount >= 1000 ? 0 : 4 });
  const px = (mark.y / CHART.height) * boxHeight;
  const leftPct = (mark.x / CHART.width) * 100;

  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-semibold leading-tight text-ink shadow-lg"
      style={{ left: `${leftPct}%`, top: Math.max(0, px - 46), background: COLOR[mark.trade.side] }}
    >
      <p>{mark.trade.side === "buy" ? t("chart.trade.bought") : t("chart.trade.sold")}</p>
      <p className="font-normal opacity-80">
        {amount} · {qty} ${mark.trade.ticker}
      </p>
    </div>
  );
}
