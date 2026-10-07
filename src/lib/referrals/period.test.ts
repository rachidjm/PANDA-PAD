import { test } from "node:test";
import assert from "node:assert/strict";
import { isPeriodKey, periodRange, previousPeriodRange } from "./period";

// A fixed instant: 2026-03-15 14:30:00 UTC (a Sunday), mid-month, so month/prevMonth boundaries are unambiguous.
const NOW = Date.UTC(2026, 2, 15, 14, 30, 0);
const DAY = 86_400_000;

test("today: from this UTC midnight to now", () => {
  assert.deepEqual(periodRange({ key: "today" }, NOW), { from: Date.UTC(2026, 2, 15), to: NOW });
});

test("yesterday: the full UTC day before today", () => {
  assert.deepEqual(periodRange({ key: "yesterday" }, NOW), { from: Date.UTC(2026, 2, 14), to: Date.UTC(2026, 2, 15) });
});

test("7d: today plus the 6 days before it (7 days total), up to now", () => {
  const r = periodRange({ key: "7d" }, NOW)!;
  assert.equal(r.to, NOW);
  assert.equal((Date.UTC(2026, 2, 15) - r.from) / DAY, 6);
});

test("30d: today plus the 29 days before it", () => {
  const r = periodRange({ key: "30d" }, NOW)!;
  assert.equal((Date.UTC(2026, 2, 15) - r.from) / DAY, 29);
});

test("month: the 1st of the current UTC month to now", () => {
  assert.deepEqual(periodRange({ key: "month" }, NOW), { from: Date.UTC(2026, 2, 1), to: NOW });
});

test("prevMonth: the whole previous UTC calendar month, nothing from the current one", () => {
  assert.deepEqual(periodRange({ key: "prevMonth" }, NOW), { from: Date.UTC(2026, 1, 1), to: Date.UTC(2026, 2, 1) });
});

test("prevMonth across a year boundary", () => {
  const jan = Date.UTC(2026, 0, 15);
  assert.deepEqual(periodRange({ key: "prevMonth" }, jan), { from: Date.UTC(2025, 11, 1), to: Date.UTC(2026, 0, 1) });
});

test("all: no bound at all", () => {
  assert.equal(periodRange({ key: "all" }, NOW), null);
});

test("custom: exactly what was given, as long as from <= to", () => {
  assert.deepEqual(periodRange({ key: "custom", from: 100, to: 200 }, NOW), { from: 100, to: 200 });
});

test("custom: a reversed or incomplete range is refused (null, not a guess)", () => {
  assert.equal(periodRange({ key: "custom", from: 200, to: 100 }, NOW), null);
  assert.equal(periodRange({ key: "custom" }, NOW), null);
});

test("previousPeriodRange: the same-length window immediately before", () => {
  const range = { from: 1000, to: 1500 };
  assert.deepEqual(previousPeriodRange(range), { from: 500, to: 1000 });
});

test("previousPeriodRange: null in, null out — 'all' has no previous period", () => {
  assert.equal(previousPeriodRange(null), null);
});

test("isPeriodKey: only the real keys pass", () => {
  assert.equal(isPeriodKey("7d"), true);
  assert.equal(isPeriodKey("all"), true);
  assert.equal(isPeriodKey("nonsense"), false);
  assert.equal(isPeriodKey(undefined), false);
});
