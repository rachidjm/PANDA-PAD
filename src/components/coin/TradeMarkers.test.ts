import { test } from "node:test";
import assert from "node:assert/strict";
import { tradePriceUsd } from "./TradeMarkers";
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
