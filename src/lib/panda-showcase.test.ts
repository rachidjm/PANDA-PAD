import { test } from "node:test";
import assert from "node:assert/strict";
import { ensurePandaLaunchedFirst, ensurePandaLaunchFirst } from "./panda-showcase";
import type { SectionId } from "./home-sections";
import type { Coin } from "./types";

function coin(mint: string, overrides: Partial<Coin> = {}): Coin {
  return {
    mint,
    ticker: mint.toUpperCase(),
    name: mint,
    description: "",
    doodle: "cat",
    bg: "#fff",
    marketCap: 0,
    volume24h: 0,
    changePct: 0,
    priceHistory: [],
    creator: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "pump-fun",
    ...overrides,
  };
}

const EMPTY_SECTIONS: Record<SectionId, Coin[]> = { launched: [], graduated: [], recentlyActive: [], topGainers: [], trending: [], new: [] };

test("ensurePandaLaunchedFirst: null panda is a no-op", () => {
  const sections = { ...EMPTY_SECTIONS, launched: [coin("a")], trending: [coin("b")] };
  assert.deepEqual(ensurePandaLaunchedFirst(sections, null), sections);
});

test("ensurePandaLaunchedFirst: panda goes first in launched even when launched already has others", () => {
  const panda = coin("panda");
  const sections = { ...EMPTY_SECTIONS, launched: [coin("a"), coin("b")] };
  const result = ensurePandaLaunchedFirst(sections, panda);
  assert.deepEqual(result.launched.map((c) => c.mint), ["panda", "a", "b"]);
});

test("ensurePandaLaunchedFirst: never duplicated — removed from every other section it was claimed into", () => {
  const panda = coin("panda");
  const sections = { ...EMPTY_SECTIONS, trending: [panda, coin("x")], topGainers: [panda] };
  const result = ensurePandaLaunchedFirst(sections, panda);
  assert.deepEqual(result.trending.map((c) => c.mint), ["x"]);
  assert.deepEqual(result.topGainers, []);
  assert.deepEqual(result.launched.map((c) => c.mint), ["panda"]);
});

test("ensurePandaLaunchedFirst: already-present in launched isn't duplicated, just moved to the front", () => {
  const panda = coin("panda");
  const sections = { ...EMPTY_SECTIONS, launched: [coin("a"), panda, coin("b")] };
  const result = ensurePandaLaunchedFirst(sections, panda);
  assert.deepEqual(result.launched.map((c) => c.mint), ["panda", "a", "b"]);
});

test("ensurePandaLaunchedFirst: match is case-insensitive on the mint", () => {
  const panda = coin("PaNdA123");
  const sections = { ...EMPTY_SECTIONS, trending: [coin("pandA123")] };
  const result = ensurePandaLaunchedFirst(sections, panda);
  assert.deepEqual(result.trending, []);
  assert.deepEqual(result.launched.map((c) => c.mint), ["PaNdA123"]);
});

type L = { mint: string; ticker: string };
const l = (mint: string): L => ({ mint, ticker: mint });

test("ensurePandaLaunchFirst: null panda just caps the list", () => {
  assert.deepEqual(ensurePandaLaunchFirst([l("a"), l("b"), l("c")], null, 2), [l("a"), l("b")]);
});

test("ensurePandaLaunchFirst: panda always first, list still capped at maxLength", () => {
  const panda = l("panda");
  const result = ensurePandaLaunchFirst([l("a"), l("b"), l("c")], panda, 3);
  assert.deepEqual(result, [l("panda"), l("a"), l("b")]);
});

test("ensurePandaLaunchFirst: panda already in the list isn't duplicated", () => {
  const panda = l("panda");
  const result = ensurePandaLaunchFirst([l("a"), panda, l("b")], panda, 3);
  assert.deepEqual(result, [l("panda"), l("a"), l("b")]);
});
