import { test } from "node:test";
import assert from "node:assert/strict";
import type { Coin } from "@/lib/types";
import { assessCoin, partitionByQuality, withQuality } from "./coin-quality";
import { QUALITY_CONFIG } from "./config";

const coin = (over: Partial<Coin> & { ticker: string }): Coin => ({
  mint: `mint-${over.ticker}`,
  name: over.ticker,
  description: "",
  doodle: "cat",
  bg: "#000",
  marketCap: 100_000,
  volume24h: 1,
  changePct: 0,
  priceHistory: [],
  creator: "",
  createdAt: "2026-09-23T00:00:00Z",
  source: "pumpswap",
  ...over,
});

// ── REAL numbers from the production list (panda-pad.vercel.app/api/coins, 2026-09-23) ──────────────────────────
const REAL_JUNK = [
  coin({ ticker: "ECTF", marketCap: 127_658_556, liquidityUsd: 1_014_861.65, changePct: 261_149 }),
  coin({ ticker: "USDF", marketCap: 127_325_911, liquidityUsd: 1_013_245.69, changePct: 260_664 }),
  coin({ ticker: "OURA", marketCap: 72_250_616, liquidityUsd: 762_960.14, changePct: 147_761 }),
  coin({ ticker: "FRIC", marketCap: 23_011_364, liquidityUsd: 429_435.26, changePct: 48_144 }),
  coin({ ticker: "VSOF", marketCap: 11_852_972, liquidityUsd: 307_668.9, changePct: 24_745 }),
  coin({ ticker: "USMS", marketCap: 9_335_475, liquidityUsd: 272_858.86, changePct: 19_486 }),
  coin({ ticker: "AROS", marketCap: 6_756_190, liquidityUsd: 231_792.58, changePct: 13_983 }),
  coin({ ticker: "ZZZ", marketCap: 4_803_765, liquidityUsd: 195_166.75, changePct: 9_914 }),
];
const REAL_HEALTHY = [
  coin({ ticker: "PIPEJEAN", marketCap: 350_843, liquidityUsd: 53_662.17, changePct: 346 }),
  coin({ ticker: "ARCHIBROWN", marketCap: 377_755, liquidityUsd: 60_891.44, changePct: 772 }),
  coin({ ticker: "BLUFCAT", marketCap: 212_630, liquidityUsd: 40_210.89, changePct: 156 }),
  coin({ ticker: "APEZCAT", marketCap: 183_322, liquidityUsd: 42_245.76, changePct: 285 }),
  coin({ ticker: "KEN", marketCap: 116_492, liquidityUsd: 29_903.96, changePct: 150 }),
  coin({ ticker: "BURRITO", marketCap: 136_800, liquidityUsd: 31_310.21, changePct: 187 }),
  coin({ ticker: "GOUR", marketCap: 159_833, liquidityUsd: 36_646.26, changePct: 243 }),
  // a live bonding-curve coin: no liquidity figure exists for a curve, and its MC is bounded by the curve
  coin({ ticker: "CURVE", source: "pump-fun", marketCap: 48_015, changePct: 1_368 }),
];

test("the junk pools seen in production are all set aside, and the healthy ones are not", () => {
  for (const c of REAL_JUNK) assert.equal(assessCoin(c).quality, "suspect", `${c.ticker} should be excluded`);
  for (const c of REAL_HEALTHY) assert.equal(assessCoin(c).quality, "ok", `${c.ticker} should stay: ${assessCoin(c).reasons}`);
});

// ── The four coins the owner reported (figures as reported; their liquidity was not given) ──────────────────────
test("VSOF (MC 1.33B, +20,795%), AEON (617M, +486,020%), AROS (2.42B) and USDF (290M) are excluded whatever their liquidity was", () => {
  const reported = [
    { c: coin({ ticker: "VSOF", marketCap: 1_330_000_000, changePct: 20_795 }), maxPlausibleLiquidity: 5_000_000 },
    { c: coin({ ticker: "AEON", marketCap: 617_000_000, changePct: 486_020 }), maxPlausibleLiquidity: 5_000_000 },
    { c: coin({ ticker: "AROS", marketCap: 2_420_000_000, changePct: 13_983 }), maxPlausibleLiquidity: 5_000_000 },
    { c: coin({ ticker: "USDF", marketCap: 290_000_000, changePct: 260_664 }), maxPlausibleLiquidity: 5_000_000 },
  ];
  for (const { c, maxPlausibleLiquidity } of reported) {
    // Liquidity was not reported, so sweep every plausible value: none of them can rescue these market caps.
    for (const liq of [1, 500, 5_000, 50_000, 250_000, 1_000_000, maxPlausibleLiquidity]) {
      assert.equal(assessCoin({ ...c, liquidityUsd: liq }).quality, "suspect", `${c.ticker} with $${liq} liquidity`);
    }
    // and with no liquidity data at all (unverifiable) it is not shown either
    assert.equal(assessCoin({ ...c, liquidityUsd: undefined }).quality, "suspect");
  }
});

test("ACCEPTANCE: nothing with a market cap above 100× its liquidity ever passes (fuzz)", () => {
  let s = 12345;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 20_000; i++) {
    const liq = 10 ** (rand() * 8); // $1 … $100M
    const mc = liq * 10 ** (rand() * 5 - 1); // 0.1× … 10,000× liquidity
    const c = coin({ ticker: "F", marketCap: mc, liquidityUsd: liq, changePct: rand() * 500_000 - 100, source: rand() < 0.5 ? "pumpswap" : "other" });
    if (assessCoin(c).quality === "ok") assert.ok(c.marketCap <= liq * 100, `MC ${mc} vs liq ${liq} slipped through`);
  }
});

test("each rule fires on its own, with its own reason", () => {
  const reasons = (c: Coin) => assessCoin(c).reasons;
  assert.deepEqual(reasons(coin({ ticker: "A", marketCap: 3_000, liquidityUsd: 2_000 })), ["low_liquidity"]);
  assert.deepEqual(reasons(coin({ ticker: "B", marketCap: 5_000_000, liquidityUsd: 100_000 })), ["mc_over_liquidity"]);
  assert.deepEqual(reasons(coin({ ticker: "C", marketCap: 300_000, liquidityUsd: 100_000, changePct: 4_000 })), ["extreme_change_low_liquidity"]);
  assert.deepEqual(reasons(coin({ ticker: "D", marketCap: 300_000 })), ["no_liquidity_data"]);
  assert.deepEqual(reasons(coin({ ticker: "E", source: "pump-fun", marketCap: 900_000 })), ["curve_mc_too_high"]);
  assert.deepEqual(reasons(coin({ ticker: "F", marketCap: 0, liquidityUsd: 50_000 })), ["invalid_data"]);
  assert.deepEqual(reasons(coin({ ticker: "G", marketCap: NaN, liquidityUsd: 50_000 })), ["invalid_data"]);
});

test("a big move on a DEEP pool is left alone (only the market-cap/liquidity rule applies above the low-liquidity line)", () => {
  const c = coin({ ticker: "H", marketCap: 20_000_000, liquidityUsd: 1_000_000, changePct: 8_000 });
  assert.equal(assessCoin(c).quality, "ok");
});

test("two sources that disagree about the market cap exclude the coin; agreeing sources, or only one source, do not", () => {
  const base = { marketCap: 48_000, source: "pump-fun" as const };
  assert.deepEqual(assessCoin(coin({ ticker: "I", ...base, sourceMarketCaps: { pump: 48_000, dex: 90_000 } })).reasons, ["sources_disagree"]);
  assert.equal(assessCoin(coin({ ticker: "J", ...base, sourceMarketCaps: { pump: 48_000, dex: 50_000 } })).quality, "ok");
  assert.equal(assessCoin(coin({ ticker: "K", ...base, sourceMarketCaps: { pump: 48_000 } })).quality, "ok");
  assert.equal(assessCoin(coin({ ticker: "L", ...base, sourceMarketCaps: { pump: 48_000, dex: undefined, gecko: 20_000 } })).quality, "suspect");
  // exactly at the threshold is still fine
  const edge = 1 + QUALITY_CONFIG.maxSourceDisagreement;
  assert.equal(assessCoin(coin({ ticker: "M", ...base, sourceMarketCaps: { pump: 40_000, dex: 40_000 * edge } })).quality, "ok");
});

test("partitionByQuality never drops a coin: everything is either shown or set aside marked with its reasons", () => {
  const all = [...REAL_JUNK, ...REAL_HEALTHY];
  const { ok, suspect } = partitionByQuality(all);
  assert.equal(ok.length + suspect.length, all.length);
  assert.ok(suspect.every((c) => c.quality === "suspect" && (c.qualityReasons?.length ?? 0) > 0));
  assert.ok(ok.every((c) => c.quality === "ok" && c.qualityReasons?.length === 0));
  assert.deepEqual(ok.map((c) => c.ticker), REAL_HEALTHY.map((c) => c.ticker), "order preserved");
  // and the input objects were not mutated
  assert.equal(REAL_JUNK[0].quality, undefined);
});

test("withQuality keeps every other field", () => {
  const c = coin({ ticker: "N", marketCap: 5_000_000, liquidityUsd: 100_000, image: "x.png" });
  const m = withQuality(c);
  assert.equal(m.image, "x.png");
  assert.equal(m.quality, "suspect");
});

const PUMP_MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
// PUMP as it looked in production (2026-09-23): $1.88B market cap on $21.8M of liquidity, ~86×
const PUMP = coin({ ticker: "PUMP", mint: PUMP_MINT, marketCap: 1_869_317_477, liquidityUsd: 21_847_867.63, changePct: -8 });

test("ALLOWLIST: PUMP would be set aside by the market-cap/liquidity rule, but its mint is allowlisted, so it never is", () => {
  const without = { ...QUALITY_CONFIG, allowlistMints: [] as readonly string[] };
  assert.deepEqual(assessCoin(PUMP, without).reasons, ["mc_over_liquidity"], "the rule really does fire on it");
  assert.deepEqual(assessCoin(PUMP), { quality: "ok", reasons: [] });
  assert.equal(partitionByQuality([PUMP]).ok.length, 1);
});

test("the allowlist is per mint: a lookalike ticker, or the same numbers on another mint, is still excluded; and it beats every rule", () => {
  assert.equal(assessCoin({ ...PUMP, mint: "SomeOtherMint1111111111111111111111111111111" }).quality, "suspect");
  assert.equal(assessCoin({ ...PUMP, mint: PUMP_MINT.toLowerCase() }).quality, "suspect", "exact match only");
  const worst = coin({ ticker: "PUMP", mint: PUMP_MINT, marketCap: 9e12, liquidityUsd: 10, changePct: 1e7, sourceMarketCaps: { pump: 1, dex: 100 } });
  assert.equal(assessCoin(worst).quality, "ok");
});
