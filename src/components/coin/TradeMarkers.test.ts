import { test } from "node:test";
import assert from "node:assert/strict";
import { candleIndexFor, tradePriceUsd } from "./TradeMarkers";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";

const trade = (over: Partial<LoggedTrade>): LoggedTrade => ({
  mint: "MintA",
  ticker: "AAA",
  side: "buy",
  solAmount: 1,
  tokenAmount: 1000,
  solPriceUsdAtTrade: 150,
  signature: "sig",
  ts: 1,
  ...over,
});

test("tradePriceUsd: real USD price per token, from the trade's own recorded SOL price", () => {
  // 1 SOL spent, at $150/SOL, for 1000 tokens -> $0.15 per token
  assert.equal(tradePriceUsd(trade({})), 0.15);
});

test("tradePriceUsd: 0 (never a division by zero / Infinity) when the token amount is 0", () => {
  assert.equal(tradePriceUsd(trade({ tokenAmount: 0 })), 0);
});

test("tradePriceUsd: a sell prices exactly the same way as a buy — the formula doesn't care about side", () => {
  const buy = trade({ side: "buy", solAmount: 2, tokenAmount: 500, solPriceUsdAtTrade: 200 });
  const sell = trade({ side: "sell", solAmount: 2, tokenAmount: 500, solPriceUsdAtTrade: 200 });
  assert.equal(tradePriceUsd(buy), tradePriceUsd(sell));
  assert.equal(tradePriceUsd(buy), 0.8);
});

// ── where a trade (or an executed PANDA order) goes on the chart ────────────────────────────────────────────────────

const HOUR = 3600;
const candles = (start: number, step: number, n: number) => Array.from({ length: n }, (_, k) => ({ time: start + k * step }));

test("a sale is placed on the nearest candle, on every timeframe whose range contains it", () => {
  const sale = 1_800_000_000 + 12 * HOUR + 60; // 12:01
  const day0 = 1_800_000_000;
  assert.equal(candleIndexFor(sale, candles(day0, 60, 24 * 60)), 12 * 60 + 1, "1m: its own minute");
  assert.equal(candleIndexFor(sale, candles(day0, 300, 24 * 12)), 12 * 12, "5m: the 12:00 candle");
  assert.equal(candleIndexFor(sale, candles(day0, HOUR, 24)), 12, "1h");
  assert.equal(candleIndexFor(sale, candles(day0, 4 * HOUR, 6)), 3, "4h: the 12:00–16:00 candle");
  assert.equal(candleIndexFor(sale + 1900, candles(day0, HOUR, 24)), 13, "between two candles → the nearest");
});

test("the last candle is still open: a sale after it started (1D: today; 1h: this hour) is on it, not dropped", () => {
  const day0 = 1_800_000_000;
  const days = candles(day0 - 9 * 24 * HOUR, 24 * HOUR, 10); // the last one starts today 00:00
  assert.equal(candleIndexFor(day0 + 12 * HOUR + 60, days), 9);
  const hours = candles(day0, HOUR, 13); // the last one starts at 12:00
  assert.equal(candleIndexFor(day0 + 12 * HOUR + 60, hours), 12);
});

test("outside the chart's range (before the first candle, or more than one interval after the last) nothing is drawn", () => {
  const day0 = 1_800_000_000;
  const hours = candles(day0, HOUR, 12);
  assert.equal(candleIndexFor(day0 - 1, hours), -1);
  assert.equal(candleIndexFor(day0 + 13 * HOUR + 1, hours), -1);
  assert.equal(candleIndexFor(day0, [{ time: day0 }]), -1, "one candle is not a chart");
});
