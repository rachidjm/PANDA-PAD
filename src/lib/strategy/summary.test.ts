import { test } from "node:test";
import assert from "node:assert/strict";
import { needsNoStopNotice, summaryParts, trancheSummaryParts } from "./summary";

test("buy only, no stop: 'Compra a …' and 'sin stop', with the no-stop notice", () => {
  assert.deepEqual(summaryParts({ buy: 0.0012 }, 100), [{ key: "draw.sum.buy", price: 0.0012 }, { key: "draw.sum.noStop" }]);
  assert.equal(needsNoStopNotice({ buy: 0.0012 }), true);
});

test("sell only at 100%: plain 'Venta a …', no percentage shown", () => {
  assert.deepEqual(summaryParts({ sell: 0.002 }, 100), [{ key: "draw.sum.sell", price: 0.002 }]);
});

test("sell only at 50%: 'Venta del 50% a …'", () => {
  assert.deepEqual(summaryParts({ sell: 0.002 }, 50), [{ key: "draw.sum.sellPct", price: 0.002, pct: 50 }]);
});

test("stop only: 'Stop a …', or with its percentage when partial", () => {
  assert.deepEqual(summaryParts({ stop: 0.0008 }, 100), [{ key: "draw.sum.stop", price: 0.0008 }]);
  assert.deepEqual(summaryParts({ stop: 0.0008 }, 25), [{ key: "draw.sum.stopPct", price: 0.0008, pct: 25 }]);
});

test("sell + stop: both legs, sharing the same percentage", () => {
  assert.deepEqual(summaryParts({ sell: 0.002, stop: 0.0008 }, 50), [
    { key: "draw.sum.sellPct", price: 0.002, pct: 50 },
    { key: "draw.sum.stopPct", price: 0.0008, pct: 50 },
  ]);
});

test("the full strategy: buy, sell and stop, no 'sin stop' and no notice", () => {
  assert.deepEqual(summaryParts({ buy: 0.0012, sell: 0.002, stop: 0.0008 }, 100), [
    { key: "draw.sum.buy", price: 0.0012 },
    { key: "draw.sum.sell", price: 0.002 },
    { key: "draw.sum.stop", price: 0.0008 },
  ]);
  assert.equal(needsNoStopNotice({ buy: 0.0012, sell: 0.002, stop: 0.0008 }), false);
});

test("a sell or a stop never needs the no-stop notice (only a buy without a stop does)", () => {
  assert.equal(needsNoStopNotice({ sell: 0.002 }), false);
  assert.equal(needsNoStopNotice({ stop: 0.0008 }), false);
});

test("an empty draft has no summary at all", () => {
  assert.deepEqual(summaryParts({}, 100), []);
});

test("trancheSummaryParts chains every tranche's own parts, in order", () => {
  assert.deepEqual(trancheSummaryParts([{ pct: 25, sell: 0.002 }, { pct: 50, stop: 0.0008 }]), [
    { key: "draw.sum.sellPct", price: 0.002, pct: 25 },
    { key: "draw.sum.stopPct", price: 0.0008, pct: 50 },
  ]);
});

test("trancheSummaryParts: a tranche at 100% of the draft's OWN share still reads as plain (no pct shown)", () => {
  assert.deepEqual(trancheSummaryParts([{ pct: 100, sell: 0.002, stop: 0.0008 }]), [
    { key: "draw.sum.sell", price: 0.002 },
    { key: "draw.sum.stop", price: 0.0008 },
  ]);
});

test("trancheSummaryParts of no tranches is empty", () => {
  assert.deepEqual(trancheSummaryParts([]), []);
});
