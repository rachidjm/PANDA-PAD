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

// ── the view of the price axis: fitted by default, zoomed by the user within limits ────────────────────────────────
/**
 * The normal view: around the candles AND what matters now — the current price and the lines already drawn — with room
 * above and below to mark new ones (`room`, a fraction of the range, on top of the small base margin). It never
 * reaches zero: the bottom stays at half of the lowest thing shown, at least. A mark far from the current price (more
 * than 4 times above or below) does not stretch the view; it is drawn pinned to an edge instead (clampedY).
 */
export function fitDomain(closes: number[], marks: number[] = [], room = 0, current: number | null = null): Domain {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  const prices = closes.filter(ok);
  const near = (m: number) => !current || !ok(current) || (m >= current / 4 && m <= current * 4);
  const all = [...prices, ...marks.filter((m) => ok(m) && near(m)), ...(current && ok(current) ? [current] : [])];
  if (all.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const range = hi - lo || hi * 0.05;
  const margin = range * (BASE_MARGIN + Math.max(0, room));
  return { min: Math.max(lo - margin, lo * 0.5), max: hi + margin };
}

/**
 * How far the view may be zoomed. OUT: never below a tenth of the current price nor above ten times it (or the fitted
 * view itself, when the candles already go further) — and so never down to zero. IN: never closer than a tenth of the
 * fitted view. With no current price the fitted view's own ends take its place.
 */
/** `keep`: the current price — it always stays on screen, so a zoom can never end up looking at an empty stretch of the axis. */
export type ZoomLimits = { lo: number; hi: number; minRange: number; keep: number | null };
export function zoomLimits(fit: Domain, current: number | null): ZoomLimits {
  const ok = current !== null && Number.isFinite(current) && current > 0;
  const lo = Math.min(fit.min, ok ? current! * 0.1 : fit.min);
  const hi = Math.max(fit.max, ok ? current! * 10 : fit.max);
  return { lo: Math.max(lo, hi * 1e-9), hi, minRange: (fit.max - fit.min) * 0.1 || hi * 1e-6, keep: ok ? current! : null };
}

/** A view kept inside the limits: its size first (not too close, not too far), then its position. */
export function clampDomain(d: Domain, lim: ZoomLimits): Domain {
  const span = lim.hi - lim.lo;
  const range = Math.max(Math.min(d.max - d.min, span), Math.min(lim.minRange, span));
  let min = Math.max(lim.lo, Math.min(d.min, lim.hi - range));
  if (lim.keep !== null) {
    // The current price stays inside the view, a little away from its edges.
    const inset = range * 0.08;
    if (lim.keep < min + inset) min = lim.keep - inset;
    else if (lim.keep > min + range - inset) min = lim.keep + inset - range;
    min = Math.max(lim.lo, Math.min(min, lim.hi - range));
  }
  return { min, max: min + range };
}

/**
 * Zooms the price axis by `factor` (>1 = out, more prices on screen; <1 = in), keeping the price under the pointer
 * where it is. `anchor` is where the pointer is on the axis: 0 = the bottom of the chart, 1 = the top. Vertical only.
 */
export function zoomDomain(d: Domain, factor: number, anchor: number, lim: ZoomLimits): Domain {
  if (!Number.isFinite(factor) || factor <= 0) return clampDomain(d, lim);
  const a = Math.max(0, Math.min(1, anchor));
  const range = d.max - d.min;
  const span = lim.hi - lim.lo;
  const next = Math.max(Math.min(range * factor, span), Math.min(lim.minRange, span));
  const pivot = d.min + a * range;
  return clampDomain({ min: pivot - a * next, max: pivot + (1 - a) * next }, lim);
}

export const sameDomain = (a: Domain, b: Domain) => Math.abs(a.min - b.min) <= Math.abs(b.max) * 1e-9 && Math.abs(a.max - b.max) <= Math.abs(b.max) * 1e-9;

/** Where a pixel row sits on the axis, 0 (bottom) to 1 (top) — the `anchor` of zoomDomain. */
export function rowToAnchor(y: number, height: number = CHART.height, padding: number = CHART.padding): number {
  return Math.max(0, Math.min(1, 1 - (y - padding) / (height - padding * 2)));
}

/** How much one notch of the mouse wheel (or a stretch of the trackpad) zooms: gentle, and never a jump. */
export function wheelFactor(deltaPx: number): number {
  return Math.exp(Math.max(-80, Math.min(80, deltaPx)) * 0.0015);
}
