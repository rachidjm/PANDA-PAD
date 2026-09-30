import { test } from "node:test";
import assert from "node:assert/strict";
import { abort, cancel, down, IDLE, move, start, up, type DrawState } from "./draw-machine";
import { CHART, clampedY, clientYToChartY, domainFor, priceToY, spreadLabels, yToPrice } from "./scale";

const mouse = { type: "mouse", button: 0 };
const touch = { type: "touch" };

test("mouse: hovering moves the line, click sets the price and leaves the mode", () => {
  let s: DrawState = start("buy");
  assert.equal(s.preview, null); // nothing is drawn until the pointer is over the chart
  s = move(s, 1.1, { ...mouse, pressed: false });
  assert.equal(s.preview, 1.1);
  s = move(s, 1.2, { ...mouse, pressed: false });
  assert.equal(s.preview, 1.2);
  s = down(s, 1.2, mouse);
  const r = up(s, 1.2, mouse);
  assert.equal(r.picked, 1.2);
  assert.deepEqual(r.state, IDLE);
});

test("touch: a finger can't hover, so moving without pressing does nothing", () => {
  const s = move(start("sell1"), 1.5, { ...touch, pressed: false });
  assert.equal(s.preview, null);
});

test("touch: a tap (down then up) sets the price where the finger landed", () => {
  let s = start("sell1");
  s = down(s, 1.8, touch);
  assert.equal(s.preview, 1.8);
  const r = up(s, 1.8, touch);
  assert.equal(r.picked, 1.8);
  assert.equal(r.state.target, null);
});

test("touch: dragging moves the line with the finger and lifting sets it at the last position", () => {
  let s = start("buy");
  s = down(s, 1.0, touch);
  s = move(s, 1.1, { ...touch, pressed: true });
  s = move(s, 1.25, { ...touch, pressed: true });
  assert.equal(s.preview, 1.25);
  assert.equal(up(s, 1.25, touch).picked, 1.25);
});

test("mouse and touch end in the same result for the same final position", () => {
  const m = up(down(move(start("buy"), 2, { ...mouse, pressed: false }), 2, mouse), 2, mouse);
  const t = up(down(start("buy"), 2, touch), 2, touch);
  assert.deepEqual(m, t);
});

test("releasing without having pressed on the chart confirms nothing", () => {
  const r = up(start("buy"), 1.2, mouse);
  assert.equal(r.picked, null);
  assert.equal(r.state.target, "buy"); // still choosing
});

test("only the primary mouse button confirms", () => {
  const s = down(start("buy"), 1.2, { type: "mouse", button: 2 });
  assert.equal(s.armed, false);
  assert.equal(up(s, 1.2, { type: "mouse", button: 2 }).picked, null);
});

test("pointercancel (the browser took the gesture, e.g. to scroll) confirms nothing", () => {
  let s = down(start("buy"), 1.2, touch);
  s = abort(s);
  assert.equal(s.armed, false);
  assert.equal(s.preview, null);
  assert.equal(up(s, 1.3, touch).picked, null);
});

test("with no mode active the gesture is inert; cancel returns to idle", () => {
  assert.equal(move(IDLE, 1, { ...mouse, pressed: false }), IDLE);
  assert.equal(down(IDLE, 1, mouse), IDLE);
  assert.equal(up(IDLE, 1, mouse).picked, null);
  assert.deepEqual(cancel(), IDLE);
});

test("chart scale: the domain always fits the closes, with a small fixed margin", () => {
  const d = domainFor([2, 1, 3]);
  assert.ok(d.min < 1 && d.max > 3); // margin on both sides, not exactly min..max any more
  assert.ok(Math.abs(d.min - (1 - 2 * 0.06)) < 1e-9 && Math.abs(d.max - (3 + 2 * 0.06)) < 1e-9);
});

test("chart scale: price → row → price round-trips", () => {
  const d = domainFor([1, 2, 3], 0.25);
  for (const p of [0.9, 1.7, 2.5, 3.9]) assert.ok(Math.abs(yToPrice(priceToY(p, d), d) - p) < 1e-9);
});

test("chart scale: drawing adds extra headroom on top of the base margin", () => {
  const plain = domainFor([1, 2]);
  const drawing = domainFor([1, 2], 0.25);
  assert.ok(drawing.max > plain.max && drawing.min < plain.min);
});

test("chart scale: a line/marker outside the domain clamps to the edge instead of stretching it", () => {
  const d = domainFor([1, 2]); // small margin around [1,2], well short of 3.5 or 0.1
  const above = clampedY(3.5, d);
  assert.equal(above.out, "above");
  assert.equal(above.y, CHART.padding);
  const below = clampedY(0.1, d);
  assert.equal(below.out, "below");
  assert.equal(below.y, CHART.height - CHART.padding);
  const inside = clampedY(1.5, d);
  assert.equal(inside.out, null);
  assert.equal(inside.y, priceToY(1.5, d));
});

test("chart scale: a line can be dragged to the bottom edge without becoming a zero or negative price", () => {
  const d = domainFor([0.001, 0.002], 0.25);
  assert.ok(yToPrice(CHART.height, d) > 0);
  assert.ok(yToPrice(CHART.height * 5, d) > 0);
});

test("chart scale: pointer position maps to the chart's own rows and is clamped", () => {
  assert.equal(clientYToChartY(150, 100, 520), 25); // svg drawn twice as tall as its coordinate system
  assert.equal(clientYToChartY(50, 100, 260), 0);
  assert.equal(clientYToChartY(900, 100, 260), CHART.height);
  assert.equal(clientYToChartY(150, 100, 0), 0);
});

test("price tags never overlap and stay in order", () => {
  const out = spreadLabels([100, 102, 104, 250], 18, 260);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] - out[i - 1] >= 18 - 1e-9);
  assert.ok(out[0] <= out[1] && out[1] <= out[2]);
  assert.equal(out[3], 250);
  const bottom = spreadLabels([255, 256, 257], 18, 260);
  assert.ok(Math.max(...bottom) <= 260);
  for (let i = 1; i < 3; i++) assert.ok(bottom[i] - bottom[i - 1] >= 18 - 1e-9);
});
