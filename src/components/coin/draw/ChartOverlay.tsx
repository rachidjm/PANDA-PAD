"use client";

import { useEffect, useRef, useState } from "react";
import { formatPct } from "@/lib/format";
import type { DrawTarget } from "@/lib/strategy/draw-machine";
import { pctVsBuy } from "@/lib/strategy/plan";
import { CHART, clampedY, spreadLabels, type Domain } from "@/lib/strategy/scale";
import type { ChartLine } from "./useDrawTrade";

export type ChartOverlayData = {
  lines: ChartLine[];
  /** Which line the user is placing right now, if any. */
  drawing: DrawTarget | null;
  /** The line being placed is a sell / stop on a coin already held (no buy drawn) — its sell shows green. */
  drawingHeld?: boolean;
  /** Real USD price, same space as every `ChartLine.price` — never the display unit directly. */
  preview: number | null;
  onPointer: (phase: "move" | "down" | "up" | "leave", price: number, info: { type: string; button: number; pressed: boolean }) => void;
  labels: (target: DrawTarget) => string;
  previewLabels: (target: DrawTarget) => string;
  /** Converts a real USD price into whatever the Y axis is showing right now (price or market cap) — for
   *  positioning only; every line's own data (and the % vs. buy) always stays real USD underneath. */
  toDisplay: (usd: number) => number;
  /** The inverse of `toDisplay` — needed by a tag's own drag-start (below), which only has a screen position. */
  fromDisplay: (displayValue: number) => number;
  /** A real USD price, formatted in the unit currently on screen (price or market cap). */
  formatValue: (usd: number) => string;
  /** Grabbing a draggable tranche leg's tag (its `trancheId` is set — see useDrawTrade.ts's `lines`) arms the
   *  SAME press-drag-release the chart already uses to place a brand new line, just seeded on this existing
   *  one: moving the pointer without lifting repositions it live, lifting commits the new price. */
  grabLine?: (line: ChartLine, price: number, info: { type: string; button: number }) => void;
};

/** 0-based index of a sell tranche target ("sell1" → 0 … up to MAX_TRANCHES); -1 for "buy"/"stop". Mirrors
 *  useDrawTrade.ts's own `sellIndexOf` — kept local so this module has no import cycle back into the hook. */
function sellSlotIndex(target: DrawTarget): number {
  const m = /^sell(\d+)$/.exec(target);
  return m ? Number(m[1]) - 1 : -1;
}

/** Draw Your Trade's own 3 brand colors, nothing else: buy = lime green, sell = cream white, stop = soft
 *  coral red (see globals.css's --draw-buy/--draw-sell/--draw-stop). A legacy multi-tranche strategy (from
 *  before staggered selling was removed) can still have several saved sell legs to display — those extra
 *  legs are shades of the same sell color instead of a 4th hue, so the palette never grows past the 3. */
export function lineColor(kind: DrawTarget): string {
  if (kind === "buy") return "var(--draw-buy)";
  if (kind === "stop") return "var(--draw-stop)";
  const idx = sellSlotIndex(kind);
  if (idx <= 0) return "var(--draw-sell)";
  const light = 60 + ((idx * 11) % 25); // legacy extra legs: the same cream hue, just a lightness ramp to tell them apart
  return `hsl(42 35% ${light}%)`;
}

/** A held-coin sell (no buy on the chart to confuse it with) is green, like its card in the panel; the rest as lineColor. */
export function heldLineColor(kind: DrawTarget, held?: boolean): string {
  return held && kind !== "buy" && kind !== "stop" ? "var(--bamboo)" : lineColor(kind);
}

/** A small solid triangle pinned to the top/bottom edge, pointing further off-screen — stands in for a line or
 *  a trade marker that's out of the currently visible price range, instead of stretching the scale to fit it
 *  (see scale.ts's `clampedY`). Its real price is still shown in the tag/tooltip, just not drawn at scale. */
export function EdgeArrow({ x, y, out, color }: { x: number; y: number; out: "above" | "below"; color: string }) {
  const points = out === "above" ? `${x - 6},${y + 9} ${x + 6},${y + 9} ${x},${y}` : `${x - 6},${y - 9} ${x + 6},${y - 9} ${x},${y}`;
  return <polygon points={points} fill={color} stroke="var(--ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
}

/** The dashed lines inside the chart's own SVG (nothing is filled: the chart's background stays as it was). */
export function StrategyLines({ overlay, domain }: { overlay: ChartOverlayData; domain: Domain }) {
  return (
    <g pointerEvents="none">
      {overlay.lines.map((l) => {
        const { y, out } = clampedY(overlay.toDisplay(l.price), domain);
        if (out) return <EdgeArrow key={l.key} x={CHART.width - 16} y={y} out={out} color={heldLineColor(l.kind, l.held)} />;
        return (
          <g key={l.key}>
          {/* a dark halo under every line keeps it readable over the curve and the gridlines */}
          <line x1={0} x2={CHART.width} y1={y} y2={y} stroke="var(--ink)" strokeOpacity={0.55} strokeWidth={4.5} vectorEffect="non-scaling-stroke" />
          <line
            x1={0}
            x2={CHART.width}
            y1={y}
            y2={y}
            stroke={heldLineColor(l.kind, l.held)}
            strokeWidth={l.active || l.live ? 2 : 1.5}
            strokeDasharray={l.kind === "stop" ? "2 4" : "8 4"}
            strokeOpacity={l.live || l.active ? 0.95 : 0.7}
            vectorEffect="non-scaling-stroke"
          />
          </g>
        );
      })}
      {overlay.drawing && overlay.preview !== null && (
        (() => {
          const { y, out } = clampedY(overlay.toDisplay(overlay.preview), domain);
          if (out) return <EdgeArrow x={CHART.width - 16} y={y} out={out} color={heldLineColor(overlay.drawing, overlay.drawingHeld)} />;
          return (
            <>
              <line x1={0} x2={CHART.width} y1={y} y2={y} stroke="var(--ink)" strokeOpacity={0.55} strokeWidth={5.5} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={CHART.width} y1={y} y2={y} stroke={heldLineColor(overlay.drawing, overlay.drawingHeld)} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            </>
          );
        })()
      )}
    </g>
  );
}

/** Price tags on the right edge (the tag of the line being placed sits on the left, out of the way of a finger coming from the right).
 * HTML, not SVG: the SVG is stretched to the card, which would stretch the text too. The box is shorter on a phone, so the
 * positions are scaled to its real height. */
export function PriceTags({
  overlay,
  domain,
  priceAtClientY,
  onGrabPointer,
}: {
  overlay: ChartOverlayData;
  domain: Domain;
  /** Same conversion AreaChart itself drags with (clientY → real USD) — kept in ONE place so a line grabbed by
   *  its tag and a line placed by clicking the chart always land on the exact same price. Only needed when a
   *  tranche leg can actually be dragged (`overlay.grabLine` set); undefined otherwise. */
  priceAtClientY?: (clientY: number) => number;
  /** Tells the chart which pointer to keep tracking on `window` once a tag starts a drag — the SAME tracking
   *  AreaChart already runs for a line placed by clicking the chart itself. */
  onGrabPointer?: (pointerId: number) => void;
}) {
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

  // Short, clean tags: "Compra $1.0M", "Venta $1.5M · +51%" — the "#N" strategy tag only gets added when more
  // than one strategy is actually drawn on the chart at once (otherwise it's just noise).
  const multipleGroups = new Set(overlay.lines.map((l) => l.groupId)).size > 1;

  // The live % every line shows: relative to ITS OWN group's buy target (a chart can have several drawn
  // strategies open at once, each with its own buy price) — updates on every drag, since it's derived from
  // the price, never stored separately (and is unit-independent: a ratio of two prices is the same ratio of
  // their market caps, so it's never converted).
  const items = overlay.lines.map((l) => {
    const buyPrice = l.kind === "buy" ? l.price : overlay.lines.find((x) => x.groupId === l.groupId && x.kind === "buy")?.price;
    const pct = l.kind !== "buy" ? pctVsBuy(l.price, buyPrice) : null;
    const { y, out } = clampedY(overlay.toDisplay(l.price), domain);
    const arrow = out === "above" ? "↑ " : out === "below" ? "↓ " : "";
    const parts = [`${arrow}${overlay.labels(l.kind)}${multipleGroups ? ` ${l.tag}` : ""} ${overlay.formatValue(l.price)}`];
    if (pct !== null) parts.push(formatPct(pct));
    if (l.pct !== undefined) parts.push(`${l.pct}%`);
    // Only a DRAFT tranche's own leg can be grabbed and dragged — never a live/saved line, and never the plain
    // (non-tranche) buy/sell/stop lines, which are repriced by typing instead (see DrawTradePanel.tsx).
    const draggable = !!overlay.grabLine && !l.live && !!l.lineId;
    return { key: l.key, kind: l.kind, held: l.held, text: parts.join(" · "), y: px(y), strong: l.live || l.active, line: l, draggable };
  });
  const previewY = overlay.drawing && overlay.preview !== null ? px(clampedY(overlay.toDisplay(overlay.preview), domain).y) : null;
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
          onPointerDown={
            it.draggable && priceAtClientY && overlay.grabLine
              ? (e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  overlay.grabLine!(it.line, priceAtClientY(e.clientY), { type: e.pointerType, button: e.button });
                  onGrabPointer?.(e.pointerId);
                }
              : undefined
          }
          className={`absolute right-1 -translate-y-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink ${it.draggable ? "pointer-events-auto cursor-grab active:cursor-grabbing" : ""}`}
          style={{ top: Math.max(9, spread[i]), background: heldLineColor(it.kind, it.held), opacity: it.strong ? 1 : 0.75, touchAction: it.draggable ? "none" : undefined }}
        >
          {it.text}
        </span>
      ))}
      {previewY !== null && overlay.drawing && (
        <span
          className="absolute left-2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold leading-none text-ink shadow-lg"
          style={{ top: Math.min(Math.max(10, previewY), h - 10), background: heldLineColor(overlay.drawing, overlay.drawingHeld) }}
        >
          {overlay.previewLabels(overlay.drawing)} · {overlay.formatValue(overlay.preview!)}
        </span>
      )}
    </div>
  );
}
