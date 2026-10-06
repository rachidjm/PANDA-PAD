import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDisplayValue, parseDisplayValue, priceDecimals, sanitizeDisplayInput } from "./display";

test("formatDisplayValue: a market cap is abbreviated with its suffix, never a raw integer", () => {
  assert.equal(formatDisplayValue(6687622, "mcap", "es"), "$6,69M");
  assert.equal(formatDisplayValue(6687622, "mcap", "en"), "$6.69M");
  assert.equal(formatDisplayValue(1_250_000_000, "mcap", "es"), "$1,25B");
  assert.equal(formatDisplayValue(45_300, "mcap", "es"), "$45,3K");
  assert.equal(formatDisplayValue(850, "mcap", "es"), "$850");
});

test("formatDisplayValue: a token price keeps the decimals its first significant digits need", () => {
  assert.equal(formatDisplayValue(0.00012, "price", "es"), "$0,00012");
  assert.equal(formatDisplayValue(0.0020, "price", "es"), "$0,002");
  assert.equal(formatDisplayValue(1.5, "price", "en"), "$1.5");
  assert.equal(formatDisplayValue(250, "price", "en"), "$250");
});

test("formatDisplayValue: nothing to show for zero, negative, or non-finite values", () => {
  assert.equal(formatDisplayValue(0, "price", "es"), "");
  assert.equal(formatDisplayValue(-1, "mcap", "es"), "");
  assert.equal(formatDisplayValue(Number.NaN, "price", "es"), "");
});

test("priceDecimals: grows with how small the price is, capped at 10", () => {
  assert.equal(priceDecimals(2), 2);
  assert.equal(priceDecimals(0.5), 4);
  assert.equal(priceDecimals(0.00012), 6);
  assert.equal(priceDecimals(1e-15), 10);
});

test("parseDisplayValue: reads back exactly what the field shows, in both languages", () => {
  assert.equal(parseDisplayValue("$6,69M"), 6_690_000);
  assert.equal(parseDisplayValue("$6.69M"), 6_690_000);
  assert.equal(parseDisplayValue("$0,00012"), 0.00012);
  assert.equal(parseDisplayValue("6687622"), 6687622);
});

test("parseDisplayValue: suffixes K, M and B, in any case, with a decimal", () => {
  assert.equal(parseDisplayValue("45,3k"), 45_300);
  assert.equal(parseDisplayValue("1.25B"), 1_250_000_000);
  assert.equal(parseDisplayValue("2m"), 2_000_000);
});

test("parseDisplayValue: when both separators appear, the last one is the decimal mark", () => {
  assert.equal(parseDisplayValue("1.234,5"), 1234.5);
  assert.equal(parseDisplayValue("1,234.5"), 1234.5);
});

test("parseDisplayValue: a separator repeated is a thousands separator", () => {
  assert.equal(parseDisplayValue("6.687.622"), 6687622);
  assert.equal(parseDisplayValue("6,687,622"), 6687622);
});

test("parseDisplayValue: rejects empty, zero, negative, and malformed text", () => {
  assert.equal(parseDisplayValue(""), null);
  assert.equal(parseDisplayValue("   "), null);
  assert.equal(parseDisplayValue("0"), null);
  assert.equal(parseDisplayValue("-5"), null);
  assert.equal(parseDisplayValue("abc"), null);
  assert.equal(parseDisplayValue("1..2"), null);
});

test("format then parse round-trips for the values a strategy actually uses", () => {
  for (const n of [0.00012, 0.0020, 0.5, 1.25, 6687622, 45300]) {
    const shown = formatDisplayValue(n, n > 1000 ? "mcap" : "price", "es");
    const back = parseDisplayValue(shown);
    assert.ok(back !== null);
    assert.ok(Math.abs(back - n) / n < 0.01, `${n} → ${shown} → ${back}`);
  }
});

test("sanitizeDisplayInput: keeps digits, separators, $ and the K/M/B suffix; drops everything else", () => {
  assert.equal(sanitizeDisplayInput("$6,69M!"), "$6,69M");
  assert.equal(sanitizeDisplayInput("xyz-12"), "12");
});
