"use client";

import { useEffect, useRef, useState } from "react";
import { formatPct, formatPrice } from "@/lib/format";
import type { DrawTarget } from "@/lib/strategy/draw-machine";
import { pctVsBuy } from "@/lib/strategy/plan";
import { CHART, priceToY, spreadLabels, type Domain } from "@/lib/strategy/scale";
import type { ChartLine } from "./useDrawTrade";

export type ChartOverlayData = {
  lines: ChartLine[];
  /** Which line the user is placing right now, if any. */
  drawing: DrawTarget | null;
  preview: number | null;
  onPointer: (phase: "move" | "down" | "up" | "leave", price: number, info: { type: string; button: number; pressed: boolean }) => void;
  labels: (target: DrawTarget) => string;
  previewLabels: (target: DrawTarget) => string;
};

/** 0-based index of a sell tranche target ("sell1" → 0 … up to MAX_TRANCHES); -1 for "buy"/"stop". Mirrors
 *  useDrawTrade.ts's own `sellIndexOf` — kept local so this module has no import cycle back into the hook. */
function sellSlotIndex(target: DrawTarget): number {
  const m = /^sell(\d+)$/.exec(target);
  return m ? Number(m[1]) - 1 : -1;
}

/** Buy = red (as asked) — a crimson, so it stays readable on the orange-red curve of a falling coin; every sell
 *  tranche is a shade of the same cool blue (so they read as "the sell family", never confused with the buy
 *  line or the stop's orange), spread across a lightness ramp so up to 10 of them stay tellable apart; stop =
 *  the site's orange. */
export function lineColor(kind: DrawTarget): string {
  if (kind === "buy") return "var(--draw-buy)";
  if (kind === "stop") return "var(--meme-orange)";
  const idx = sellSlotIndex(kind);
  if (idx <= 0) return "var(--draw-sell)"; // the plain, non-staggered case keeps the exact same color as before
  const light = 42 + ((idx * 37) % 46); // a shuffled spread, not a plain ramp, so neighbours (#2/#3) read apart too
  return `hsl(200 85% ${light}%)`;
}

/** The dashed lines inside the chart's own SVG (nothing is filled: the chart's background stays as it was). */
export function StrategyLines({ overlay, domain }: { overlay: ChartOverlayData; domain: Domain }) {
  return (
    <g pointerEvents="none">
      {overlay.lines.map((l) => {
        const y = priceToY(l.price, domain);
        return (
          <g key={l.key}>
          {/* a dark halo under every line keeps it readable over the curve and the gridlines */}
          <line x1={0} x2={CHART.width} y1={y} y2={y} stroke="var(--ink)" strokeOpacity={0.55} strokeWidth={4.5} vectorEffect="non-scaling-stroke" />
          <line
            x1={0}
            x2={CHART.width}
            y1={y}
            y2={y}
            stroke={lineColor(l.kind)}
            strokeWidth={l.active || l.live ? 2 : 1.5}
            strokeDasharray={l.kind === "stop" ? "2 4" : "8 4"}
            strokeOpacity={l.live || l.active ? 0.95 : 0.7}
            vectorEffect="non-scaling-stroke"
          />
          </g>
        );
      })}
      {overlay.drawing && overlay.preview !== null && (
        <>
        <line x1={0} x2={CHART.width} y1={priceToY(overlay.preview, domain)} y2={priceToY(overlay.preview, domain)} stroke="var(--ink)" strokeOpacity={0.55} strokeWidth={5.5} vectorEffect="non-scaling-stroke" />
        <line
          x1={0}
          x2={CHART.width}
          y1={priceToY(overlay.preview, domain)}
          y2={priceToY(overlay.preview, domain)}
          stroke={lineColor(overlay.drawing)}
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
        </>
      )}
    </g>
  );
}

/** Price tags on the right edge (the tag of the line being placed sits on the left, out of the way of a finger coming from the right).
 * HTML, not SVG: the SVG is stretched to the card, which would stretch the text too. The box is shorter on a phone, so the
 * positions are scaled to its real height. */
export function PriceTags({ overlay, domain }: { overlay: ChartOverlayData; domain: Domain }) {
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number>(CHART.height);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setH(el.clientHeight || CHART.height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const px = (y: number) => (y / CHART.height) * h;

  // The live % every line shows: relative to ITS OWN group's buy target (a chart can have several drawn
  // strategies open at once, each with its own buy price) — updates on every drag, since it's derived from
  // the price, never stored separately.
  const items = overlay.lines.map((l) => {
    const buyPrice = l.kind === "buy" ? l.price : overlay.lines.find((x) => x.groupId === l.groupId && x.kind === "buy")?.price;
    const pct = l.kind !== "buy" ? pctVsBuy(l.price, buyPrice) : null;
    const parts = [`${overlay.labels(l.kind)} ${l.tag}`, formatPrice(l.price)];
    if (pct !== null) parts.push(formatPct(pct));
    if (l.pct !== undefined) parts.push(`${l.pct}%`);
    return { key: l.key, kind: l.kind, text: parts.join(" · "), y: px(priceToY(l.price, domain)), strong: l.live || l.active };
  });
  const previewY = overlay.drawing && overlay.preview !== null ? px(priceToY(overlay.preview, domain)) : null;
  const spread = spreadLabels(
    items.map((i) => i.y),
    18,
    h - 9
  );
  return (
    <div ref={box} className="pointer-events-none absolute inset-x-0 top-0 h-[170px] sm:h-[260px]" aria-hidden>
      {items.map((it, i) => (
        <span
          key={it.key}
          className="absolute right-1 -translate-y-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink"
          style={{ top: Math.max(9, spread[i]), background: lineColor(it.kind), opacity: it.strong ? 1 : 0.75 }}
        >
          {it.text}
        </span>
      ))}
      {previewY !== null && overlay.drawing && (
        <span
          className="absolute left-2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold leading-none text-ink shadow-lg"
          style={{ top: Math.min(Math.max(10, previewY), h - 10), background: lineColor(overlay.drawing) }}
        >
          {overlay.previewLabels(overlay.drawing)} · {formatPrice(overlay.preview!)}
        </span>
      )}
    </div>
  );
}
