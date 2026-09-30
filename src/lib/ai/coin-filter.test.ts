import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAiCoinFilter, EMPTY_AI_FILTER, isActiveAiFilter, type AiCoinFilter } from "./coin-filter";
import type { Coin } from "@/lib/types";

function coin(over: Partial<Coin> = {}): Coin {
  return {
    mint: over.mint ?? `mint-${Math.random()}`,
    ticker: "TEST",
    name: "Test Coin",
    description: "",
    doodle: "cat",
    bg: "#fff",
    marketCap: 10_000,
    volume24h: 1_000,
    changePct: 0,
    priceHistory: [],
    creator: "creator",
    createdAt: new Date().toISOString(),
    source: "pump-fun",
    ...over,
  };
}

test("an empty filter is a no-op: everything matches, and it isn't 'active'", () => {
  assert.equal(isActiveAiFilter(EMPTY_AI_FILTER), false);
  const coins = [coin(), coin(), coin()];
  assert.deepEqual(applyAiCoinFilter(coins, EMPTY_AI_FILTER), coins);
});

test("maxAgeHours excludes anything older", () => {
  const fresh = coin({ mint: "fresh", createdAt: new Date(Date.now() - 1 * 3_600_000).toISOString() });
  const old = coin({ mint: "old", createdAt: new Date(Date.now() - 48 * 3_600_000).toISOString() });
  const filter: AiCoinFilter = { ...EMPTY_AI_FILTER, maxAgeHours: 24 };
  assert.ok(isActiveAiFilter(filter));
  assert.deepEqual(applyAiCoinFilter([fresh, old], filter).map((c) => c.mint), ["fresh"]);
});

test("liquidity and market cap bounds", () => {
  const thin = coin({ mint: "thin", liquidityUsd: 1_000, marketCap: 5_000 });
  const deep = coin({ mint: "deep", liquidityUsd: 100_000, marketCap: 5_000_000 });
  assert.deepEqual(applyAiCoinFilter([thin, deep], { ...EMPTY_AI_FILTER, minLiquidityUsd: 50_000 }).map((c) => c.mint), ["deep"]);
  assert.deepEqual(applyAiCoinFilter([thin, deep], { ...EMPTY_AI_FILTER, maxMarketCap: 1_000_000 }).map((c) => c.mint), ["thin"]);
  // A coin with no liquidity data at all never clears a minimum — unknown is not "enough".
  const unknownLiq = coin({ mint: "unknown" });
  assert.deepEqual(applyAiCoinFilter([unknownLiq], { ...EMPTY_AI_FILTER, minLiquidityUsd: 1 }), []);
});

test("rugSafe only keeps coins RugCheck itself rated 'good' — unknown is excluded, never assumed safe", () => {
  const safe = coin({ mint: "safe" });
  const risky = coin({ mint: "risky" });
  const unknown = coin({ mint: "unknown" });
  const filter: AiCoinFilter = { ...EMPTY_AI_FILTER, rugSafe: true };
  const out = applyAiCoinFilter([safe, risky, unknown], filter, { safe: "good", risky: "danger" });
  assert.deepEqual(out.map((c) => c.mint), ["safe"]);
});

test("filters combine (all must pass)", () => {
  const a = coin({ mint: "a", marketCap: 100, liquidityUsd: 100 });
  const b = coin({ mint: "b", marketCap: 100_000, liquidityUsd: 100_000 });
  const filter: AiCoinFilter = { ...EMPTY_AI_FILTER, minMarketCap: 50_000, minLiquidityUsd: 50_000 };
  assert.deepEqual(applyAiCoinFilter([a, b], filter).map((c) => c.mint), ["b"]);
});
