import { test } from "node:test";
import assert from "node:assert/strict";
import { assetFromUnit, maxInViewUnit, toBaseUnits, unitFromAsset } from "./amount";
import { buildPayTokens, MIN_PAY_LIQUIDITY_USD } from "./pay-tokens";
import type { DexPair } from "@/lib/dexscreener/client";

test("assetFromUnit: the asset itself passes through; $ and € use that asset's own price; a missing price means null, never a guess", () => {
  assert.equal(assetFromUnit("ASSET", 2.5, null, null, 6), 2.5);
  assert.equal(assetFromUnit("USD", 50, 2, null, 6), 25);
  assert.equal(assetFromUnit("EUR", 50, 2, 1.1, 6), 27.5);
  assert.equal(assetFromUnit("USD", 50, null, 1.1, 6), null);
  assert.equal(assetFromUnit("EUR", 50, 2, null, 6), null);
  assert.equal(assetFromUnit("USD", 0, 2, null, 6), 0);
  assert.equal(assetFromUnit("USD", NaN, 2, null, 6), 0);
});

test("assetFromUnit rounds DOWN, so it never asks for more than was typed", () => {
  // $10 at $3 per token = 3.3333333… → 3.333333 at 6 places, never 3.333334
  assert.equal(assetFromUnit("USD", 10, 3, null, 9), 3.333333);
  assert.equal(assetFromUnit("USD", 10, 3, null, 2), 3.33);
});

test("unitFromAsset / maxInViewUnit are the inverse views, and the max always fits", () => {
  assert.equal(unitFromAsset("USD", 25, 2, null), 50);
  assert.ok(Math.abs(unitFromAsset("EUR", 27.5, 2, 1.1)! - 50) < 1e-9);
  assert.equal(unitFromAsset("USD", 25, null, null), null);
  for (const price of [0.0123, 1, 87.31, 25000]) {
    for (const bal of [0.5, 3.333333, 120.987654]) {
      const usd = maxInViewUnit("USD", bal, price, null, 6)!;
      const back = assetFromUnit("USD", usd, price, null, 6)!;
      assert.ok(back <= bal + 1e-9, `${back} must fit in ${bal}`);
    }
  }
});

test("toBaseUnits: exact integer strings, truncated not rounded, no float loss on big amounts", () => {
  assert.equal(toBaseUnits(1.5, 6), "1500000");
  assert.equal(toBaseUnits(0.000001, 6), "1");
  assert.equal(toBaseUnits(0.0000019, 6), "1"); // cut, not rounded up to 2
  assert.equal(toBaseUnits(100, 0), "100");
  assert.equal(toBaseUnits(2.5, 9), "2500000000");
  assert.equal(toBaseUnits(123456.789012, 9), "123456789012000");
  assert.equal(toBaseUnits(0, 6), "0");
  assert.equal(toBaseUnits(-1, 6), "0");
  assert.equal(toBaseUnits(NaN, 6), "0");
  assert.equal(toBaseUnits(1, 19), "0", "absurd decimals refused");
  assert.match(toBaseUnits(1_000_000_000, 9), /^1000000000000000000$/);
});

const pair = (mint: string, symbol: string, priceUsd: string, liq: number, image?: string): DexPair =>
  ({ chainId: "solana", dexId: "raydium", pairAddress: `p-${mint}`, baseToken: { address: mint, name: `${symbol} coin`, symbol }, quoteToken: { address: "So11", name: "SOL", symbol: "SOL" }, priceUsd, liquidity: { usd: liq }, info: image ? { imageUrl: image } : undefined }) as DexPair;

test("buildPayTokens keeps only tokens with a real price and enough liquidity, skips dust and SOL, biggest value first", () => {
  const balances = [
    { mint: "USDC", amount: 250, decimals: 6 },
    { mint: "BONK", amount: 5_000_000, decimals: 5 },
    { mint: "RUG", amount: 1_000, decimals: 6 }, // liquidity too low
    { mint: "DUST", amount: 0.001, decimals: 6 }, // worth < $0.10
    { mint: "NOPAIR", amount: 10, decimals: 6 }, // no market
    { mint: "So11111111111111111111111111111111111111112", amount: 3, decimals: 9 }, // SOL has its own row
  ];
  const pairs = [
    pair("USDC", "USDC", "1.0", 5_000_000, "https://img/usdc.png"),
    pair("BONK", "BONK", "0.00002", 900_000),
    pair("RUG", "RUG", "1", MIN_PAY_LIQUIDITY_USD - 1),
    pair("DUST", "DUST", "1", 100_000),
  ];
  const out = buildPayTokens(balances, pairs);
  assert.deepEqual(out.map((t) => t.symbol), ["USDC", "BONK"]); // $250 then $100
  assert.equal(out[0].image, "https://img/usdc.png");
});

test("buildPayTokens sorts by USD value and uses the most liquid pair", () => {
  const out = buildPayTokens(
    [
      { mint: "A", amount: 10, decimals: 6 },
      { mint: "B", amount: 1000, decimals: 6 },
    ],
    [pair("A", "AAA", "5", 10_000), pair("A", "AAA", "9", 2_000_000), pair("B", "BBB", "0.01", 50_000)]
  );
  assert.deepEqual(out.map((t) => [t.symbol, t.priceUsd, t.valueUsd]), [["AAA", 9, 90], ["BBB", 0.01, 10]]);
});
