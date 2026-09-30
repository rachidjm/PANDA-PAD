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
