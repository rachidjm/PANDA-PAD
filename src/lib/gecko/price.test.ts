import { test } from "node:test";
import assert from "node:assert/strict";
import { priceOfMintInPools, type GeckoPool } from "./client";

const SOL = "So11111111111111111111111111111111111111112";
const pool = (name: string, base: string, quote: string, reserve: string, basePrice: string, quotePrice: string): GeckoPool =>
  ({
    id: name,
    attributes: { name, address: name, base_token_price_usd: basePrice, quote_token_price_usd: quotePrice, reserve_in_usd: reserve, fdv_usd: null, market_cap_usd: null, volume_usd: {}, price_change_percentage: {}, pool_created_at: null },
    relationships: { base_token: { data: { id: `solana_${base}`, type: "token" } }, quote_token: { data: { id: `solana_${quote}`, type: "token" } } },
  }) as GeckoPool;

// The shape GeckoTerminal really returned for SOL: the biggest pool is "TDOF / SOL", with SOL on the QUOTE side.
const SOL_POOLS = [
  pool("TDOF / SOL", "TDOFmint", SOL, "70224982", "0.0708", "115.01"),
  pool("SOL / USDC", SOL, "USDCmint", "42149717", "114.58", "0.9975"),
  pool("BOME / SOL", "BOMEmint", SOL, "18043387", "0.00105", "114.58"),
];

test("REGRESSION: SOL is priced from ITS side of the most liquid pool, not from the other coin's price (0.0153 SOL showed as $0.00)", () => {
  assert.equal(priceOfMintInPools(SOL_POOLS, SOL), 115.01);
  assert.ok(0.0153 * (priceOfMintInPools(SOL_POOLS, SOL) as number) > 1.7, "0.0153 SOL is about $1.76, not $0.00");
});

test("a normal coin is priced from the base side of its most liquid pool", () => {
  const pools = [pool("PUMP / SOL", "PUMPmint", SOL, "1000", "0.002", "115"), pool("PUMP / USDC", "PUMPmint", "USDCmint", "5000", "0.0021", "1")];
  assert.equal(priceOfMintInPools(pools, "PUMPmint"), 0.0021);
});

test("no pool, a missing price or a zero price is 'unknown', never a made-up number", () => {
  assert.equal(priceOfMintInPools([], SOL), undefined);
  assert.equal(priceOfMintInPools([pool("A / B", "Amint", "Bmint", "1", "0", "0")], "Amint"), undefined);
  assert.equal(priceOfMintInPools([pool("A / B", "Amint", "Bmint", "1", "1", "1")], "Cmint"), undefined, "the mint isn't in the best pool");
});
