import { test } from "node:test";
import assert from "node:assert/strict";
import { countUnread, deriveNotifications } from "./notifications";
import type { StrategyRecord } from "./types";

const base: StrategyRecord = {
  id: "s1",
  n: 1,
  wallet: "w",
  mint: "MINT1",
  ticker: "PANDA",
  fundingAsset: "SOL",
  fundingMint: "SOL",
  inputAmountRaw: "1",
  amountUsd: 10,
  feeLamports: 0,
  feeState: "none",
  state: "waiting",
  depositRequestId: "r1",
  createdAt: 1000,
  updatedAt: 1000,
  expiresAt: 2000,
};

test("a strategy with no signature yet produces no notification", () => {
  assert.deepEqual(deriveNotifications([base]), []);
});

test("a filled buy becomes one 'buy' notification at the buy price", () => {
  const r = { ...base, buySignature: "sig1", buyUsd: 0.0012, updatedAt: 5000 };
  assert.deepEqual(deriveNotifications([r]), [{ id: "s1:buy", strategyId: "s1", kind: "buy", mint: "MINT1", ticker: "PANDA", priceUsd: 0.0012, at: 5000 }]);
});

test("a filled sell at the take-profit uses sellUsd; at the stop uses stopUsd", () => {
  const tp = { ...base, sellSignature: "sig2", sellKind: "take_profit" as const, sellUsd: 0.002, stopUsd: 0.0008, updatedAt: 6000 };
  assert.deepEqual(deriveNotifications([tp])[0].priceUsd, 0.002);
  const sl = { ...base, sellSignature: "sig3", sellKind: "stop_loss" as const, sellUsd: 0.002, stopUsd: 0.0008, updatedAt: 7000 };
  assert.deepEqual(deriveNotifications([sl])[0].priceUsd, 0.0008);
});

test("a completed buy_sell_stop strategy produces BOTH a buy and a sell notification", () => {
  const r = { ...base, buySignature: "sig1", buyUsd: 0.0012, sellSignature: "sig2", sellKind: "take_profit" as const, sellUsd: 0.002, updatedAt: 9000 };
  const ns = deriveNotifications([r]);
  assert.equal(ns.length, 2);
  assert.ok(ns.some((n) => n.kind === "buy" && n.priceUsd === 0.0012));
  assert.ok(ns.some((n) => n.kind === "sell" && n.priceUsd === 0.002));
});

test("results come back newest first, across several strategies", () => {
  const old = { ...base, id: "old", buySignature: "a", buyUsd: 1, updatedAt: 1000 };
  const recent = { ...base, id: "recent", buySignature: "b", buyUsd: 2, updatedAt: 9000 };
  const mid = { ...base, id: "mid", buySignature: "c", buyUsd: 3, updatedAt: 5000 };
  assert.deepEqual(
    deriveNotifications([old, recent, mid]).map((n) => n.strategyId),
    ["recent", "mid", "old"]
  );
});

test("countUnread counts only what's strictly newer than the cursor", () => {
  const ns = [{ id: "a", strategyId: "a", kind: "buy" as const, mint: "m", ticker: "t", priceUsd: 1, at: 100 }, { id: "b", strategyId: "b", kind: "buy" as const, mint: "m", ticker: "t", priceUsd: 1, at: 200 }];
  assert.equal(countUnread(ns, 50), 2);
  assert.equal(countUnread(ns, 100), 1);
  assert.equal(countUnread(ns, 200), 0);
  assert.equal(countUnread([], 0), 0);
});
