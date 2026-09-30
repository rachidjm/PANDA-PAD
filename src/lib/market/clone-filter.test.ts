import { test } from "node:test";
import assert from "node:assert/strict";
import type { Coin } from "@/lib/types";
import { filterCreatorSeriesSpam, filterExactDuplicateImages, filterByImageHash, looksLikeCloneSeries } from "./clone-filter";

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

test("a same-creator relaunch series (matching name template, change%, market cap and volume) keeps only the highest-volume coin", () => {
  const superWojak = coin({ ticker: "WOJAK", name: "Super Wojak", creator: "creatorA", changePct: 1360, marketCap: 48_700, volume24h: 22_000 });
  const superTroll = coin({ ticker: "TROLL", name: "Super Troll", creator: "creatorA", changePct: 1360, marketCap: 10_100, volume24h: 9_000 });
  const unrelated = coin({ ticker: "BONK2", name: "Bonk Two", creator: "creatorB", changePct: 40, marketCap: 500_000, volume24h: 50_000 });

  const out = filterCreatorSeriesSpam([superTroll, superWojak, unrelated]);
  assert.deepEqual(out.map((c) => c.ticker).sort(), ["BONK2", "WOJAK"]);
});

test("looksLikeCloneSeries: different creators, or no name overlap, or stats too far apart, are never a series", () => {
  const a = coin({ ticker: "A", name: "Super Wojak", creator: "x", changePct: 100, marketCap: 10_000, volume24h: 1_000 });
  assert.equal(looksLikeCloneSeries(a, { ...a, mint: "m2", creator: "y" }), false, "different creator");
  assert.equal(looksLikeCloneSeries(a, { ...a, mint: "m2", name: "Totally Different" }), false, "no shared name token");
  assert.equal(looksLikeCloneSeries(a, { ...a, mint: "m2", changePct: 500 }), false, "change% too far apart");
  assert.equal(looksLikeCloneSeries(a, { ...a, mint: "m2", marketCap: 1_000_000 }), false, "market cap ratio too large");
  assert.equal(looksLikeCloneSeries(a, { ...a, mint: "m2", name: "Super Wojak Two" }), true, "same creator, shared token, close stats");
});

test("a prolific creator's genuinely different coins (different % change) are never merged", () => {
  const a = coin({ ticker: "A", name: "Moon Cat", creator: "creatorC", changePct: 20, marketCap: 100_000, volume24h: 5_000 });
  const b = coin({ ticker: "B", name: "Moon Dog", creator: "creatorC", changePct: 900, marketCap: 200_000, volume24h: 40_000 });
  const out = filterCreatorSeriesSpam([a, b]);
  assert.deepEqual(out.map((c) => c.ticker).sort(), ["A", "B"]);
});

test("filterExactDuplicateImages keeps only the highest-volume coin per exact image URL, and never touches coins without an image", () => {
  const a = coin({ ticker: "A", image: "https://cdn/x.png", volume24h: 10 });
  const b = coin({ ticker: "B", image: "https://cdn/x.png", volume24h: 999 });
  const c = coin({ ticker: "C", image: "https://cdn/other.png", volume24h: 1 });
  const d = coin({ ticker: "D", volume24h: 1 });
  const out = filterExactDuplicateImages([a, b, c, d]);
  assert.deepEqual(out.map((x) => x.ticker).sort(), ["B", "C", "D"]);
});

test("filterByImageHash keeps only the highest-volume coin among hashes within maxDistance, and never drops a coin with no hash", () => {
  const a = coin({ ticker: "A", image: "u1", volume24h: 5 });
  const b = coin({ ticker: "B", image: "u2", volume24h: 50 });
  const c = coin({ ticker: "C", image: "u3", volume24h: 1 }); // no hash entry — hashing failed
  const hashes = new Map([
    ["mint-A", "0000"],
    ["mint-B", "0001"], // 1 bit apart from A
  ]);
  const out = filterByImageHash([a, b, c], hashes, 2, (x, y) => [...x].filter((ch, i) => ch !== y[i]).length);
  assert.deepEqual(out.map((x) => x.ticker).sort(), ["B", "C"]);
});
