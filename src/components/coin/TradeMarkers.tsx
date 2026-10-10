"use client";

import { useMemo, useState } from "react";
import { CHART, clampedY, type Domain } from "@/lib/strategy/scale";
import { formatMoney, type Currency } from "@/lib/format";
import { formatDisplayValue } from "@/lib/strategy/display";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { EdgeArrow } from "@/components/coin/draw/ChartOverlay";

/** Real USD price per token at the moment of the trade — the same figures the trade was logged with (see
 *  src/lib/portfolio/trade-log.ts), never re-estimated. */
export function tradePriceUsd(t: LoggedTrade): number {
  return t.tokenAmount > 0 ? (t.solAmount * t.solPriceUsdAtTrade) / t.tokenAmount : 0;
}

type Mark = { trade: LoggedTrade; x: number; y: number; out: "above" | "below" | null };

/** An executed PANDA order, by its transaction's signature: which line it was (sell or stop) and the % it sold. */
export type PandaExecution = { leg: "sell" | "stop"; pct: number };
export type PandaExecutions = ReadonlyMap<string, PandaExecution>;

/**
 * Which candle a moment belongs to, or -1 when it is outside what the chart shows. The LAST candle is still open: it
 * covers everything up to one more interval (a sale at 12:01 belongs to the 12:00 candle of 1h, and to today's of 1D).
 * Between two candles, the nearest one.
 */
export function candleIndexFor(tsSeconds: number, candles: { time: number }[]): number {
  if (candles.length < 2) return -1;
  const first = candles[0].time;
  const last = candles[candles.length - 1].time;
  const interval = last - candles[candles.length - 2].time;
  if (tsSeconds < first || tsSeconds > last + interval) return -1;
  let nearest = 0;
  let best = Infinity;
  for (let k = 0; k < candles.length; k++) {
    const d = Math.abs(candles[k].time - tsSeconds);
    if (d < best) {
      best = d;
      nearest = k;
    }
  }
  return nearest;
}

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
    const marks: Mark[] = [];
    for (const t of trades) {
      const nearest = candleIndexFor(Math.round(t.ts / 1000), candles);
      if (nearest === -1) continue;
      const { y, out } = clampedY(toDisplay(tradePriceUsd(t)), domain);
      marks.push({ trade: t, x: padding + nearest * step, y, out });
    }
    return marks;
  }, [trades, candles, domain, toDisplay]);
}

const COLOR = { buy: "var(--bamboo)", sell: "var(--clay-red)" };
/** A PANDA order that executed: a take-profit sell is green with "V", a stop is red with "S". Any other trade as always. */
const look = (trade: LoggedTrade, panda?: PandaExecutions) => {
  const p = panda?.get(trade.signature);
  if (p) return { color: p.leg === "sell" ? "var(--bamboo)" : "var(--clay-red)", letter: p.leg === "sell" ? "V" : "S", panda: p };
  return { color: COLOR[trade.side], letter: trade.side === "buy" ? "C" : "V", panda: null };
};

/** The dots themselves — rendered INSIDE the chart's own <svg> (same coordinate space as the price curve). */
export function TradeMarkerDots({
  trades,
  candles,
  domain,
  hoveredKey,
  onHover,
  panda,
  toDisplay = (usd) => usd,
}: {
  trades: LoggedTrade[];
  candles: { time: number; close: number }[];
  domain: Domain;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  /** Which of these trades are executed PANDA orders (by signature) — drawn with their own letter and color. */
  panda?: PandaExecutions;
  /** Converts a real USD price into whatever the Y axis is showing (price or market cap) — see PriceChart.tsx. */
  toDisplay?: (usd: number) => number;
}) {
  const marks = useTradeMarks(trades, candles, domain, toDisplay);
  // A click / tap PINS the tooltip (so its "view transaction" link can be reached); another one on the same mark lets go.
  const [pinned, setPinned] = useState<string | null>(null);
  if (marks.length === 0) return null;
  return (
    <g>
      {marks.map(({ trade, x, y, out }) => {
        const active = hoveredKey === trade.signature;
        const { color, letter } = look(trade, panda);
        return (
          <g
            key={trade.signature}
            data-trade-mark={letter}
            onPointerEnter={(e) => e.pointerType === "mouse" && onHover(trade.signature)}
            onPointerLeave={(e) => e.pointerType === "mouse" && pinned !== trade.signature && onHover(null)}
            onClick={() => {
              const unpin = pinned === trade.signature;
              setPinned(unpin ? null : trade.signature);
              onHover(unpin ? null : trade.signature);
            }}
            style={{ cursor: "pointer" }}
          >
            {/* An invisible, larger hit target — the visible dot/arrow alone is too small to reliably tap. */}
            <circle cx={x} cy={y} r={12} fill="transparent" />
            {out ? (
              <EdgeArrow x={x} y={y} out={out} color={color} />
            ) : (
              <>
                <circle cx={x} cy={y} r={active ? 8 : 6} fill={color} stroke="var(--ink)" strokeWidth={1.5} />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={active ? 8 : 7} fontWeight={800} fill="var(--ink)" pointerEvents="none">
                  {letter}
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
  panda,
  toDisplay = (usd) => usd,
}: {
  trades: LoggedTrade[];
  candles: { time: number; close: number }[];
  domain: Domain;
  hoveredKey: string | null;
  panda?: PandaExecutions;
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

  const px = (mark.y / CHART.height) * boxHeight;
  const leftPct = (mark.x / CHART.width) * 100;
  const { color, panda: order } = look(mark.trade, panda);

  if (order) {
    // "Venta PANDA · 100% · $0,000828 · 12:01" and the transaction — the real price and time of the execution.
    const when = new Date(mark.trade.ts);
    const sameDay = when.toDateString() === new Date().toDateString();
    const time = when.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
    const date = sameDay ? "" : `${when.toLocaleDateString(lang, { day: "numeric", month: "short" })} `;
    const priceText = formatDisplayValue(tradePriceUsd(mark.trade), "price", lang);
    return (
      <div
        className="absolute z-10 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-semibold leading-tight text-ink shadow-lg"
        style={{ left: `clamp(4px, calc(${leftPct}% - 90px), calc(100% - 200px))`, top: Math.max(0, px - 52), background: color }}
        data-testid="panda-exec-tooltip"
      >
        <p>
          {t(order.leg === "sell" ? "chart.trade.pandaSell" : "chart.trade.pandaStop")} · {order.pct.toLocaleString(lang, { maximumFractionDigits: 1 })}% · {priceText} · {date}
          {time}
        </p>
        <a href={`https://solscan.io/tx/${mark.trade.signature}`} target="_blank" rel="noreferrer" className="font-normal underline underline-offset-2 opacity-90 hover:opacity-100">
          {t("chart.trade.viewTx")} ↗
        </a>
      </div>
    );
  }

  const usd = mark.trade.solAmount * mark.trade.solPriceUsdAtTrade;
  const amount = currency === "EUR" && eurUsd === null ? "…" : formatMoney(currency === "EUR" ? usd / (eurUsd as number) : usd, currency, lang);
  const qty = mark.trade.tokenAmount.toLocaleString(lang, { maximumFractionDigits: mark.trade.tokenAmount >= 1000 ? 0 : 4 });
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-semibold leading-tight text-ink shadow-lg"
      style={{ left: `${leftPct}%`, top: Math.max(0, px - 46), background: color }}
    >
      <p>{mark.trade.side === "buy" ? t("chart.trade.bought") : t("chart.trade.sold")}</p>
      <p className="font-normal opacity-80">
        {amount} · {qty} ${mark.trade.ticker}
      </p>
    </div>
  );
}
