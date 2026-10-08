import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SEARCH_RANK_OPTIONS,
  RankedCoin,
  buildSearchResults,
  levenshteinDistance,
  moreRelevant,
  namesLookAlike,
  normalizeTicker,
  sameIdentityGroup,
} from "./search-rank";

const OPTS = DEFAULT_SEARCH_RANK_OPTIONS;

let seq = 0;
function coin(overrides: Partial<RankedCoin> & { ticker: string; name: string }): RankedCoin {
  seq++;
  return {
    mint: `Mint${seq}`.padEnd(32, "1"),
    description: "",
    doodle: "cat",
    bg: "#fff",
    marketCap: 0,
    volume24h: 0,
    changePct: 0,
    priceHistory: [],
    creator: "Creator1".padEnd(32, "1"),
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "pump-fun",
    liquidityUsd: 0,
    verified: false,
    ...overrides,
  };
}

// ── identity grouping ────────────────────────────────────────────────────────────────────────────────────

test("same ticker, different case/punctuation, groups together", () => {
  const a = coin({ ticker: "BONK", name: "Bonk" });
  const b = coin({ ticker: "bonk", name: "Totally Different Name" });
  assert.ok(sameIdentityGroup(a, b, OPTS));
});

test("near-identical names (formatting only) group together even with different tickers", () => {
  const a = coin({ ticker: "BONKINU", name: "Bonk Inu" });
  const b = coin({ ticker: "BINU", name: "BonkInu" });
  assert.ok(sameIdentityGroup(a, b, OPTS));
});

test("a real, different project does NOT group just because it shares one word", () => {
  const a = coin({ ticker: "BONK", name: "Bonk" });
  const b = coin({ ticker: "BABYBONK", name: "Baby Bonk" });
  assert.ok(!sameIdentityGroup(a, b, OPTS), "sharing the word 'bonk' isn't the same coin");
});

test("levenshteinDistance: identical, empty, and real edits", () => {
  assert.equal(levenshteinDistance("bonk", "bonk"), 0);
  assert.equal(levenshteinDistance("", "abc"), 3);
  assert.equal(levenshteinDistance("bonk", "bonks"), 1);
  assert.equal(levenshteinDistance("kitten", "sitting"), 3);
});

test("namesLookAlike respects the ratio, not just a fixed count", () => {
  // "pepe" vs "pepes" — 1 edit on a 5-char word is within a generous ratio.
  assert.ok(namesLookAlike("pepe", "pepes", 0.3));
  // "pepe" vs "doge" — same length, every character different: never close.
  assert.ok(!namesLookAlike("pepe", "doge", 0.3));
});

// ── ranking within a group ───────────────────────────────────────────────────────────────────────────────

test("verified beats unverified when liquidity isn't dominant either way", () => {
  const verified = coin({ ticker: "TRUMP", name: "Official Trump", verified: true, liquidityUsd: 50_000 });
  const unverified = coin({ ticker: "TRUMP", name: "Official Trump", verified: false, liquidityUsd: 80_000 });
  assert.ok(moreRelevant(verified, unverified, OPTS) < 0, "verified wins — 1.6x liquidity isn't 'much more'");
});

test("much higher liquidity on the unverified side wins anyway (the OR clause)", () => {
  const verified = coin({ ticker: "TRUMP", name: "Trump", verified: true, liquidityUsd: 10_000 });
  const dominant = coin({ ticker: "TRUMP", name: "Trump", verified: false, liquidityUsd: 100_000 }); // 10x
  assert.ok(moreRelevant(dominant, verified, OPTS) < 0, "10x liquidity dominates a stale verified tag");
});

test("liquidity, then 24h volume, then age, in that order", () => {
  const higherLiq = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 5000, volume24h: 100 });
  const lowerLiq = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 2000, volume24h: 9000 });
  assert.ok(moreRelevant(higherLiq, lowerLiq, OPTS) < 0, "liquidity outranks volume");

  const moreVolume = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 5000, volume24h: 9000 });
  const lessVolume = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 5000, volume24h: 100 });
  assert.ok(moreRelevant(moreVolume, lessVolume, OPTS) < 0, "tie on liquidity falls to volume");

  const older = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 5000, volume24h: 100, createdAt: "2025-01-01T00:00:00.000Z" });
  const newer = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 5000, volume24h: 100, createdAt: "2026-01-01T00:00:00.000Z" });
  assert.ok(moreRelevant(older, newer, OPTS) < 0, "tie on liquidity and volume falls to age");
});

test("the pinned exact-address match always outranks everything else in its group", () => {
  const huge = coin({ ticker: "BONK", name: "Bonk", verified: true, liquidityUsd: 5_000_000 });
  const pasted = coin({ ticker: "BONK", name: "Bonk", liquidityUsd: 1 });
  assert.ok(moreRelevant(pasted, huge, OPTS, pasted.mint) < 0);
});

// ── full pipeline: grouping + hiding + ordering ──────────────────────────────────────────────────────────

test("a BONK-style search: many copies collapse into one group with the rest behind '+N'", () => {
  const real = coin({ ticker: "BONK", name: "Bonk", verified: true, liquidityUsd: 2_000_000, volume24h: 500_000 });
  const copies = Array.from({ length: 12 }, (_, i) => coin({ ticker: "BONK", name: `Bonk ${i}`, liquidityUsd: 5000 + i, volume24h: 100 }));
  const result = buildSearchResults([real, ...copies], "BONK", OPTS);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].primary.mint, real.mint);
  assert.equal(result.groups[0].others.length, 12);
  assert.equal(result.hidden.length, 0);
});

test("near-zero liquidity with no volume is hidden by default, not deleted", () => {
  const real = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 100_000, volume24h: 10_000 });
  const dust = coin({ ticker: "DUST", name: "Random Dust Coin", liquidityUsd: 50, volume24h: 0 });
  const result = buildSearchResults([real, dust], "PEPE", OPTS);
  assert.equal(result.groups.length, 1, "dust never appears as its own visible group");
  assert.equal(result.hidden.length, 1);
  assert.equal(result.hidden[0].mint, dust.mint);
});

test("low liquidity but real 24h volume is NOT hidden — volume alone proves it's actually traded", () => {
  const thin = coin({ ticker: "FRESH", name: "Fresh Launch", liquidityUsd: 10, volume24h: 5000 });
  const result = buildSearchResults([thin], "FRESH", OPTS);
  assert.equal(result.hidden.length, 0);
  assert.equal(result.groups.length, 1);
});

test("an exact contract-address match is never hidden and is always first, liquidity or not", () => {
  const dustButPasted = coin({ ticker: "RUG", name: "Rugged Coin", liquidityUsd: 0, volume24h: 0 });
  const unrelatedBig = coin({ ticker: "BIG", name: "Big Coin", liquidityUsd: 1_000_000, volume24h: 100_000 });
  const result = buildSearchResults([unrelatedBig, dustButPasted], dustButPasted.mint, OPTS, { exactMint: dustButPasted.mint });
  assert.equal(result.hidden.length, 0, "the pasted CA is protected from the liquidity gate");
  assert.equal(result.groups[0].primary.mint, dustButPasted.mint, "the pasted CA is always first");
});

test("a PANDA-launched coin and a held coin are never hidden even with zero liquidity", () => {
  const launched = coin({ ticker: "PLAUNCH", name: "Panda Launch", liquidityUsd: 0, volume24h: 0, launchedOnPanda: true });
  const held = coin({ ticker: "HELD", name: "Held Coin", liquidityUsd: 0, volume24h: 0 });
  const other = coin({ ticker: "OTHER", name: "Other Coin", liquidityUsd: 50_000, volume24h: 1000 });
  const result = buildSearchResults([other, launched, held], "x", OPTS, { neverHide: new Set([launched.mint, held.mint]) });
  assert.equal(result.hidden.length, 0);
  assert.equal(result.groups.length, 3);
});

test("exact ticker match to the query ranks before a merely-similar one, regardless of liquidity", () => {
  const exact = coin({ ticker: "PEPE", name: "Pepe", liquidityUsd: 1000, volume24h: 10 });
  const bigButDifferentTicker = coin({ ticker: "PEPECOIN2", name: "Pepecoin 2", liquidityUsd: 10_000_000, volume24h: 1_000_000 });
  const result = buildSearchResults([bigButDifferentTicker, exact], "PEPE", OPTS);
  assert.equal(result.groups.length, 2, "different enough tickers/names don't merge");
  assert.equal(result.groups[0].primary.mint, exact.mint, "exact ticker match to the query comes first");
});

test("with no query ticker to match, groups just sort by relevance", () => {
  const smaller = coin({ ticker: "A", name: "Coin A", liquidityUsd: 1000 });
  const bigger = coin({ ticker: "B", name: "Coin B", liquidityUsd: 50_000 });
  const result = buildSearchResults([smaller, bigger], "something nobody's ticker matches", OPTS);
  assert.equal(result.groups[0].primary.mint, bigger.mint);
});

test("normalizeTicker strips punctuation and case so '$bonk' and 'BONK' are the same key", () => {
  assert.equal(normalizeTicker("$bonk"), "BONK");
  assert.equal(normalizeTicker("BONK"), "BONK");
});
