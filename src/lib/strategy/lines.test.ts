import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatedPct, availableForLeg, fitsLeg, legPct, linesOf, placeLine, removeLine, updateLinePrice, type Tranche } from "./allocation";
import { orderCount } from "./problem";

const sells = (n: number, pct: number): Tranche[] => {
  let t: Tranche[] = [];
  for (let i = 0; i < n; i++) t = placeLine(t, "sell", pct, 2 + i, `s${i}`);
  return t;
};

test("sticky mode: three taps at 15% are three sells of 15%, and 55% is left for sells", () => {
  const t = sells(3, 15);
  assert.deepEqual(linesOf(t).map((l) => [l.leg, l.pct, l.price]), [["sell", 15, 2], ["sell", 15, 3], ["sell", 15, 4]]);
  assert.equal(availableForLeg(t, "sell"), 55);
  assert.equal(availableForLeg(t, "stop"), 100);
});

test("at 90% of sells only 5% and 10% still fit; nothing ever passes 100%", () => {
  const t = placeLine(placeLine([], "sell", 50, 2, "a"), "sell", 40, 3, "b");
  assert.equal(availableForLeg(t, "sell"), 10);
  assert.deepEqual([5, 10, 15, 20, 25, 50, 100].filter((p) => fitsLeg(t, "sell", p)), [5, 10]);
  assert.equal(placeLine(t, "sell", 15, 4), t, "a % that doesn't fit changes nothing");
});

test("sells and stops each have their own 100%: a 100% stop under two 50% sells protects the same coins", () => {
  const t = placeLine(sells(2, 50), "stop", 100, 1, "x");
  assert.equal(legPct(t, "sell"), 100);
  assert.equal(legPct(t, "stop"), 100);
  assert.equal(allocatedPct(t), 100, "the coins are committed once, never twice");
  assert.deepEqual(linesOf(t).map((l) => [l.leg, l.pct]), [["sell", 50], ["sell", 50], ["stop", 100]]);
  assert.equal(orderCount(t), 4, "two oco pairs: two sells + the stop on each");
});

test("a stop smaller than a sell splits it; the sell still shows as ONE line", () => {
  const t = placeLine(placeLine([], "sell", 50, 2, "s"), "stop", 30, 1, "x");
  assert.deepEqual(t.map((x) => [x.pct, x.sell, x.stop]), [[30, 2, 1], [20, 2, undefined]]);
  assert.deepEqual(linesOf(t).map((l) => [l.leg, l.pct]), [["sell", 50], ["stop", 30]]);
  assert.equal(allocatedPct(t), 50);
});

test("a stop bigger than the unpaired sells takes the rest from the free balance", () => {
  const t = placeLine(placeLine([], "sell", 20, 2, "s"), "stop", 50, 1, "x");
  assert.equal(allocatedPct(t), 50);
  assert.deepEqual(linesOf(t).map((l) => [l.leg, l.pct]), [["sell", 20], ["stop", 50]]);
});

test("removing a line takes it out of every tranche and joins the pieces back", () => {
  const t = placeLine(placeLine([], "sell", 50, 2, "s"), "stop", 30, 1, "x");
  const back = removeLine(t, "stop", "x");
  assert.deepEqual(back.map((x) => [x.pct, x.sell, x.stop]), [[50, 2, undefined]]);
  assert.deepEqual(removeLine(t, "sell", "s").map((x) => [x.pct, x.stop]), [[30, 1]]);
});

test("moving a line moves it everywhere it spans", () => {
  const t = updateLinePrice(placeLine(sells(2, 50), "stop", 100, 1, "x"), "stop", "x", 0.5);
  assert.deepEqual(t.map((x) => x.stop), [0.5, 0.5]);
});

test("old tranches without line ids are each their own line", () => {
  const old: Tranche[] = [{ id: "a", pct: 40, sell: 2 }];
  const t = placeLine(old, "stop", 20, 1, "x");
  assert.deepEqual(linesOf(t).map((l) => [l.leg, l.pct]), [["sell", 40], ["stop", 20]]);
});
