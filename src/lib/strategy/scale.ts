/**
 * The chart's price ↔ pixel mapping, in one place so the line the user drags and the curve underneath it
 * always agree. The vertical scale ALWAYS fits the visible candles alone, with a small fixed margin — a
 * strategy line or a trade marker outside that range never stretches it (see `clampedY` below: those render
 * as an arrow pinned to the top/bottom edge instead of pulling the whole scale to fit them).
 */

export const CHART = { width: 720, height: 260, padding: 8 } as const;

export type Domain = { min: number; max: number };

/** Always applied, even with nothing else going on — the curve never touches the very top/bottom edge. */
const BASE_MARGIN = 0.06;

/** `headroom` (a fraction of the range, used only while actively drawing) adds EXTRA room on top of the base
 *  margin, so a target can be placed beyond the recent highs and lows while dragging it. */
export function domainFor(closes: number[], headroom = 0): Domain {
  const all = closes.filter((n) => Number.isFinite(n));
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 0;
  const range = max - min || max * 0.05 || 1;
  const margin = range * (BASE_MARGIN + Math.max(0, headroom));
  return { min: Math.max(min - margin, 0), max: max + margin };
}

/**
 * Where a price lands on the chart's own row scale, clamped to the visible box: inside the domain it's the
 * real row; above or below it, it's pinned to the top/bottom edge instead of a row that would sit off-canvas.
 * `out` says which edge (or null when it's genuinely inside), for drawing a small arrow instead of the usual
 * shape — that's the only visual difference; the real price is still whatever the caller already has.
 */
export function clampedY(price: number, d: Domain, height: number = CHART.height, padding: number = CHART.padding): { y: number; out: "above" | "below" | null } {
  if (price > d.max) return { y: padding, out: "above" };
  if (price < d.min) return { y: height - padding, out: "below" };
  return { y: priceToY(price, d, height, padding), out: null };
}

export function priceToY(price: number, d: Domain, height: number = CHART.height, padding: number = CHART.padding): number {
  const range = d.max - d.min || 1;
  return padding + (height - padding * 2) * (1 - (price - d.min) / range);
}

/** The price under a pixel row. Never zero or negative: a price line can't go below the floor of the chart. */
export function yToPrice(y: number, d: Domain, height: number = CHART.height, padding: number = CHART.padding): number {
  const range = d.max - d.min || 1;
  const frac = 1 - (y - padding) / (height - padding * 2);
  const price = d.min + frac * range;
  const floor = Math.max(d.min * 0.01, 1e-12);
  return Math.max(price, floor);
}

/** Pointer position (client pixels) → row inside the chart's own coordinate system. */
export function clientYToChartY(clientY: number, rectTop: number, rectHeight: number, height: number = CHART.height): number {
  if (rectHeight <= 0) return 0;
  return Math.max(0, Math.min(height, ((clientY - rectTop) / rectHeight) * height));
}

/**
 * Keeps price tags from sitting on top of each other: same order, at least `minGap` apart, inside `max`.
 * Returns the adjusted position for each input, in input order.
 */
export function spreadLabels(ys: number[], minGap: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const o of order) {
    const prev = placed.length ? placed[placed.length - 1] : -Infinity;
    placed.push(Math.max(o.y, prev + minGap));
  }
  // If pushing down ran past the bottom, pull the stack back up.
  for (let k = placed.length - 1; k >= 0; k--) {
    const limit = k === placed.length - 1 ? max : placed[k + 1] - minGap;
    if (placed[k] > limit) placed[k] = limit;
  }
  const out: number[] = new Array(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]));
  return out;
}

// ── the user's own view of the price axis: zoomed in or out, moved up or down ────────────────────────────────────────
/**
 * `scale` is how much of the fitted range is on screen (1 = the normal view, 2 = twice as much: zoomed OUT, 0.5 = half:
 * zoomed IN); `pan` moves the middle of the view, in units of that fitted range (+1 = one whole normal view higher).
 * Being relative to the fitted range, a view survives new candles and the price / market-cap switch unchanged.
 */
export type ChartView = { scale: number; pan: number };
export const DEFAULT_VIEW: ChartView = { scale: 1, pan: 0 };
export const VIEW_LIMITS = { minScale: 0.1, maxScale: 20, maxPan: 30 } as const;
export const isDefaultView = (v: ChartView) => Math.abs(v.scale - 1) < 1e-6 && Math.abs(v.pan) < 1e-6;

const clampNum = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The view kept inside its limits — and never below a price of zero: reaching the floor stops the move, it doesn't distort the scale. */
export function clampView(base: Domain, v: ChartView): ChartView {
  const scale = clampNum(Number.isFinite(v.scale) ? v.scale : 1, VIEW_LIMITS.minScale, VIEW_LIMITS.maxScale);
  const range = base.max - base.min || 1;
  // min of the view = centre − half = (base centre + pan·range) − scale·range/2 ≥ 0
  const floorPan = scale / 2 - (base.min + base.max) / 2 / range;
  const pan = clampNum(Number.isFinite(v.pan) ? v.pan : 0, Math.min(floorPan, VIEW_LIMITS.maxPan), VIEW_LIMITS.maxPan);
  return { scale, pan };
}

/** The prices on screen for this view of the fitted domain. With the default view it IS the fitted domain. */
export function viewDomain(base: Domain, view: ChartView): Domain {
  if (isDefaultView(view)) return base;
  const v = clampView(base, view);
  const range = base.max - base.min || 1;
  const centre = (base.min + base.max) / 2 + v.pan * range;
  const half = (range * v.scale) / 2;
  return { min: Math.max(centre - half, 0), max: centre + half };
}

/**
 * Zooms by `factor` (>1 = out, <1 = in) keeping the price under the pointer where it is. `anchor` is where the pointer
 * is on the axis: 0 = the bottom of the chart, 1 = the top.
 */
export function zoomView(base: Domain, v: ChartView, factor: number, anchor: number): ChartView {
  if (!Number.isFinite(factor) || factor <= 0) return v;
  const a = clampNum(anchor, 0, 1) - 0.5;
  const scale = clampNum(v.scale * factor, VIEW_LIMITS.minScale, VIEW_LIMITS.maxScale);
  return clampView(base, { scale, pan: v.pan + a * v.scale - a * scale });
}

/** Moves the view by a fraction of the chart's height: +0.5 = the content slides DOWN half a chart (higher prices come into view). */
export function panView(base: Domain, v: ChartView, heightFraction: number): ChartView {
  if (!Number.isFinite(heightFraction)) return v;
  return clampView(base, { scale: v.scale, pan: v.pan + heightFraction * v.scale });
}

/** Where a pixel row sits on the axis, 0 (bottom) to 1 (top) — the `anchor` of zoomView. */
export function rowToAnchor(y: number, height: number = CHART.height, padding: number = CHART.padding): number {
  return clampNum(1 - (y - padding) / (height - padding * 2), 0, 1);
}

/** What a finger or the mouse is doing on the chart once it has moved: scanning sideways, or moving the price axis. */
export function dragAxis(dx: number, dy: number, threshold = 8): "x" | "y" | null {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return null;
  return Math.abs(dy) > Math.abs(dx) ? "y" : "x";
}
