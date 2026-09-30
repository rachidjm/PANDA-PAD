import { test } from "node:test";
import assert from "node:assert/strict";
import type { Coin } from "@/lib/types";
import { buildHomeSections } from "./home-sections";

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

test("a coin that qualifies for Tendencia never also appears in Mayores subidas, Activas, Nuevas or Graduadas — even with plenty of other candidates", () => {
  // The single best coin on every metric — would otherwise top every section.
  const star = coin({ ticker: "STAR", volume24h: 1_000_000, changePct: 500, createdAt: "2026-09-29T00:00:00Z", activity: { h1: { buys: 999, sells: 999, buyers: 1, sellers: 1 } } });
  const filler = Array.from({ length: 50 }, (_, i) => coin({ ticker: `F${i}`, volume24h: 10 + i, changePct: 1 + i, createdAt: "2026-09-01T00:00:00Z" }));

  const sections = buildHomeSections([star, ...filler], 6);
  const allExceptTrending = [...sections.topGainers, ...sections.recentlyActive, ...sections.new, ...sections.graduated];
  assert.ok(sections.trending.some((c) => c.mint === star.mint), "star should lead Tendencia");
  assert.ok(!allExceptTrending.some((c) => c.mint === star.mint), "star should not repeat elsewhere");
});

test("a coin NEVER repeats across sections, even when the real pool is too small to fill every section — a later section is just smaller, or empty, instead", () => {
  const onlyGraduated = coin({ ticker: "GRAD", source: "pumpswap", volume24h: 1, changePct: 0, createdAt: "2026-09-29T00:00:00Z" });
  const sections = buildHomeSections([onlyGraduated], 6);
  // Trending claims it first (claim order); every later section is left empty rather than repeating it.
  assert.deepEqual(sections.trending.map((c) => c.mint), ["mint-GRAD"]);
  assert.deepEqual(sections.topGainers, []);
  assert.deepEqual(sections.recentlyActive, []);
  assert.deepEqual(sections.new, []);
  assert.deepEqual(sections.graduated, []);
});

test("a small real-world pool (fewer coins than perSection * number of sections) never repeats a coin across sections, even though later sections end up with fewer cards", () => {
  // 24 coins, perSection 12 — mirrors a quiet moment on-chain (the exact scenario that used to
  // reintroduce repeats via the old "never leave a section empty" fallback).
  const coins = Array.from({ length: 24 }, (_, i) =>
    coin({ ticker: `C${i}`, volume24h: 24 - i, changePct: 24 - i, createdAt: new Date(2026, 8, 1 + i).toISOString(), source: i % 3 === 0 ? "pumpswap" : "pump-fun" })
  );
  const sections = buildHomeSections(coins, 12);
  const seen = new Set<string>();
  for (const list of Object.values(sections)) {
    for (const c of list) {
      assert.ok(!seen.has(c.mint), `${c.ticker} repeated across sections`);
      seen.add(c.mint);
    }
  }
});

test("perSection caps each section's size", () => {
  const coins = Array.from({ length: 20 }, (_, i) => coin({ ticker: `C${i}`, volume24h: 20 - i }));
  const sections = buildHomeSections(coins, 6);
  assert.equal(sections.trending.length, 6);
});
