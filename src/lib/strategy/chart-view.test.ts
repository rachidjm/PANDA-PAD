import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampView, DEFAULT_VIEW, domainFor, dragAxis, isDefaultView, panView, priceToY, rowToAnchor, VIEW_LIMITS, viewDomain, yToPrice, zoomView, CHART } from "./scale";

/** The price axis can be zoomed and moved by the user; everything drawn on the chart reads the same resulting domain. */

const base = domainFor([10, 12, 15, 20]); // roughly 9.4 … 20.6
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

test("the default view IS the fitted domain: nothing changes for anyone who never zooms", () => {
  assert.equal(viewDomain(base, DEFAULT_VIEW), base);
  assert.ok(isDefaultView(DEFAULT_VIEW) && !isDefaultView({ scale: 2, pan: 0 }) && !isDefaultView({ scale: 1, pan: 0.1 }));
});

test("zooming out shows more above and below; zooming in shows less; the price under the pointer stays put", () => {
  const out = viewDomain(base, zoomView(base, DEFAULT_VIEW, 2, 0.5));
  assert.ok(out.max > base.max && out.min < base.min);
  assert.ok(near(out.max - out.min, (base.max - base.min) * 2));
  const inn = viewDomain(base, zoomView(base, DEFAULT_VIEW, 0.5, 0.5));
  assert.ok(near(inn.max - inn.min, (base.max - base.min) / 2));

  // Anchored: the price at 80% of the height is the same price before and after.
  for (const [factor, anchor] of [[1.7, 0.8], [0.6, 0.2], [3, 0.3], [0.4, 0.65]] as const) {
    const before = base.min + anchor * (base.max - base.min);
    const d = viewDomain(base, zoomView(base, DEFAULT_VIEW, factor, anchor));
    assert.ok(near(d.min + anchor * (d.max - d.min), before, 1e-9), `factor ${factor} at ${anchor}`);
  }
  // Zooming out with the pointer at the bottom opens room at the TOP: that's how a sell above the chart gets marked.
  const top = viewDomain(base, zoomView(base, DEFAULT_VIEW, 2, 0));
  assert.ok(near(top.min, base.min) && top.max > base.max * 1.4);
});

test("moving: dragging down brings higher prices into view, dragging up lower ones, at the zoom in use", () => {
  const up = viewDomain(base, panView(base, DEFAULT_VIEW, 0.5));
  assert.ok(near(up.min, base.min + (base.max - base.min) / 2) && near(up.max, base.max + (base.max - base.min) / 2));
  const down = viewDomain(base, panView(base, DEFAULT_VIEW, -0.25));
  assert.ok(down.max < base.max && down.min < base.min);
  // Zoomed out twice, the same finger movement covers twice the price.
  const wide = { scale: 2, pan: 0 };
  const moved = viewDomain(base, panView(base, wide, 0.5));
  assert.ok(near(moved.max - viewDomain(base, wide).max, base.max - base.min));
  // A move and its opposite land where they started.
  const back = panView(base, panView(base, wide, 0.3), -0.3);
  assert.ok(near(back.pan, wide.pan) && near(back.scale, wide.scale));
});

test("limits: never below a price of zero, never an absurd zoom, never a broken number", () => {
  // Zoomed far out, the floor is zero and the scale is NOT squashed: the range on screen is exactly the zoomed range.
  const far = clampView(base, { scale: 10, pan: -50 });
  const d = viewDomain(base, far);
  assert.equal(d.min, 0);
  assert.ok(near(d.max - d.min, (base.max - base.min) * 10));
  assert.deepEqual(clampView(base, far), far, "clamping twice changes nothing");
  assert.equal(zoomView(base, DEFAULT_VIEW, 1e9, 0.5).scale, VIEW_LIMITS.maxScale);
  assert.equal(zoomView(base, DEFAULT_VIEW, 1e-9, 0.5).scale, VIEW_LIMITS.minScale);
  assert.equal(panView(base, DEFAULT_VIEW, 1e9).pan, VIEW_LIMITS.maxPan);
  for (const bad of [NaN, Infinity, -1, 0]) assert.deepEqual(zoomView(base, DEFAULT_VIEW, bad, 0.5), DEFAULT_VIEW);
  assert.deepEqual(panView(base, DEFAULT_VIEW, NaN), DEFAULT_VIEW);
  assert.deepEqual(clampView(base, { scale: NaN, pan: NaN }), DEFAULT_VIEW);
  // A coin with a flat or empty history still gives a usable view.
  for (const closes of [[], [5], [5, 5, 5]]) {
    const b = domainFor(closes);
    const v = viewDomain(b, zoomView(b, DEFAULT_VIEW, 3, 0.5));
    assert.ok(Number.isFinite(v.min) && Number.isFinite(v.max) && v.max > v.min && v.min >= 0);
  }
});

test("lines and the pointer use the SAME zoomed domain: a price marked in a zoomed view is the price that is stored", () => {
  const d = viewDomain(base, panView(base, zoomView(base, DEFAULT_VIEW, 2.5, 0.3), 0.4));
  for (const price of [d.min * 1.01 + 0.01, (d.min + d.max) / 2, d.max * 0.99]) {
    assert.ok(near(yToPrice(priceToY(price, d), d), price, 1e-9));
  }
  // A sell far above the candles is unreachable in the normal view and reachable once zoomed out.
  const target = base.max * 1.8;
  assert.ok(priceToY(target, base) < 0, "off the top of the normal view");
  const y = priceToY(target, viewDomain(base, zoomView(base, DEFAULT_VIEW, 3, 0)));
  assert.ok(y >= CHART.padding && y <= CHART.height - CHART.padding);
});

test("gestures: where the pointer is on the axis, and whether a drag reads the chart or moves it", () => {
  assert.equal(rowToAnchor(CHART.padding), 1);
  assert.equal(rowToAnchor(CHART.height - CHART.padding), 0);
  assert.equal(rowToAnchor(CHART.height / 2), 0.5);
  assert.equal(rowToAnchor(-50), 1);
  assert.equal(dragAxis(3, 4), null, "not decided yet");
  assert.equal(dragAxis(20, 5), "x", "sideways: read the chart");
  assert.equal(dragAxis(5, -20), "y", "up and down: move the price axis");
  assert.equal(dragAxis(3, 5, 4), "y", "the mouse decides sooner");
});

test("the chart: gestures stay inside it, and drawing and dragging lines keep working on top of the view", () => {
  const src = readFileSync("src/components/coin/PriceChart.tsx", "utf8");
  assert.ok(src.includes('touchAction: "none"'), "a touch that starts on the chart never scrolls the page; anywhere else it does");
  assert.ok(src.includes('el.addEventListener("wheel", listener, { passive: false })') && src.includes("e.ctrlKey) return"), "the wheel zooms only over the chart, and ctrl + wheel stays the browser's");
  assert.ok(src.includes("const domain = viewDomain(base, view);"));
  // One domain for the curve, the strategy lines, the price tags, the trade markers and the pointer.
  for (const use of ["<StrategyLines overlay={overlay} domain={domain} />", "<PriceTags overlay={overlay} domain={domain} priceAtClientY={priceAtClientY}", "yToPrice(clientYToChartY(clientY, rect.top, rect.height), domain)"]) assert.ok(src.includes(use), use);
  // A second finger while a line is being placed drops that line instead of committing it somewhere unintended.
  const pinch = src.slice(src.indexOf("function startPinch()"), src.indexOf("function viewGestureMove"));
  assert.ok(pinch.includes('overlay!.onPointer("leave"') && pinch.includes("setDragPointerId(null)"));
  // While drawing, one finger still places the line (the view is moved with two fingers there).
  const down = src.slice(src.indexOf("onPointerDown={(e) => {"), src.indexOf("onPointerUp={(e) => {"));
  assert.ok(down.indexOf("if (pointers.current.size === 2) return startPinch();") < down.indexOf('overlay!.onPointer("down"'));
  assert.ok(down.indexOf('overlay!.onPointer("down"') < down.indexOf('gesture.current = { kind: "one"'));
  assert.ok(src.includes("setViewOf({ tf, view: DEFAULT_VIEW })") && src.includes("{resetLabel}"), "a way back to the normal view");
});
