/**
 * The chart's price ↔ pixel mapping, in one place so the line the user drags and the curve underneath it
 * always agree. With no strategy lines and no drawing in progress the domain is exactly the old one
 * (min..max of the closes), so the chart looks the same as before.
 */

export const CHART = { width: 720, height: 260, padding: 8 } as const;

export type Domain = { min: number; max: number };

/**
 * `extra` prices (existing lines) are always inside the picture; `headroom` (a fraction of the range, used
 * while drawing) adds room above and below so a target can be placed beyond the recent highs and lows.
 */
export function domainFor(closes: number[], extra: number[] = [], headroom = 0): Domain {
  const all = closes.filter((n) => Number.isFinite(n));
  let min = all.length ? Math.min(...all) : 0;
  let max = all.length ? Math.max(...all) : 0;
  const extras = extra.filter((n) => Number.isFinite(n) && n > 0);
  if (extras.length === 0 && headroom === 0) return { min, max };
  if (extras.length) {
    min = Math.min(min, ...extras);
    max = Math.max(max, ...extras);
  }
  const range = max - min || max * 0.05 || 1;
  const margin = range * (extras.length ? Math.max(0.08, headroom) : headroom);
  return { min: Math.max(min - margin, 0), max: max + margin };
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
