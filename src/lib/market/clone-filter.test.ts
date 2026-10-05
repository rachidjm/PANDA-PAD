import { test } from "node:test";
import assert from "node:assert/strict";
import type { Coin } from "@/lib/types";
import {
  filterCreatorSeriesSpam,
  filterTemplateSpam,
  filterStatsOnlyRing,
  filterCapVolumeRing,
  filterExactDuplicateImages,
  filterByImageHash,
  looksLikeCloneSeries,
  looksLikeTemplateSpam,
} from "./clone-filter";

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

// ── real production data (panda-pad.vercel.app/api/coins, 2026-09-30): a scripted spam ring, five
// coins named "Super <word>", each from a DIFFERENT creator wallet, but reporting the exact same
// 24h change and market caps/volumes within ~1% of each other — the pattern filterTemplateSpam
// exists for (looksLikeCloneSeries alone would miss this: it requires a matching creator). ──────
const REAL_TEMPLATE_SPAM = [
  coin({ ticker: "SI", name: "Super Idiot", creator: "41H61KHoC6qZ8ZrW5NBbVj7qEjFjTBebR6w99PTT9BQv", changePct: 1322, marketCap: 657_637, volume24h: 1_624_203 }),
  coin({ ticker: "SUPERWIF", name: "Super Wif", creator: "7d3HnbppBXT5iqT1MSUZX11AeqSHn8RbYX7HSjuksVoY", changePct: 1360, marketCap: 49_043, volume24h: 10_146 }),
  coin({ ticker: "SA", name: "SUPER ARTHUR", creator: "BnQyt1i5F1W6Z5kJS73KoG9c7LRLCsqkVi4Prm175uvX", changePct: 1360, marketCap: 48_948, volume24h: 10_127 }),
  coin({ ticker: "SW", name: "Super Wojak", creator: "75qTWKuPt5kdgBjRxFFjPo3fon6NnR94EVgMttdRQV9E", changePct: 1360, marketCap: 48_862, volume24h: 10_109 }),
  coin({ ticker: "SUPERVRAX", name: "Super VRAX", creator: "Drq8VskUCBRHeUntAyCD9eiuEbbmHjtsemoNs3i1bEmk", changePct: 1360, marketCap: 48_854, volume24h: 10_107 }),
  coin({ ticker: "ST", name: "Super Troll", creator: "2VN9YiWVDXXJbYx2PSD6x35NiTBrc3aYJKP253kCXs2X", changePct: 1360, marketCap: 48_730, volume24h: 10_082 }),
];

test("real data: filterCreatorSeriesSpam alone does NOT catch a cross-wallet template-spam ring (different creator per coin)", () => {
  const out = filterCreatorSeriesSpam(REAL_TEMPLATE_SPAM);
  assert.equal(out.length, REAL_TEMPLATE_SPAM.length, "no same-creator pair exists, so nothing should be dropped by this pass alone");
});

test("real data: filterTemplateSpam collapses the 'Super X' ring to the single highest-volume coin, keeping the unrelated 'Super Idiot' (too far off on stats) separate", () => {
  const out = filterTemplateSpam(REAL_TEMPLATE_SPAM);
  // Super Idiot's own change% (1322) is already outside the default 5-point tolerance of the
  // ring's 1360, and its market cap/volume are an order of magnitude apart — a real, unrelated coin.
  assert.deepEqual(out.map((c) => c.ticker).sort(), ["SI", "SUPERWIF"]);
});

test("looksLikeTemplateSpam requires no creator match, but does require a close change%, market cap and volume all at once", () => {
  const a = coin({ ticker: "A", name: "Super Foo", creator: "x", changePct: 1360, marketCap: 50_000, volume24h: 10_000 });
  const b = coin({ ticker: "B", name: "Super Bar", creator: "y", changePct: 1360, marketCap: 50_500, volume24h: 10_200 });
  assert.equal(looksLikeTemplateSpam(a, b), true, "different creators, but name template + all three stats close");
  assert.equal(looksLikeTemplateSpam(a, { ...b, mint: "m2", marketCap: 500_000 }), false, "market cap 10x apart");
  assert.equal(looksLikeTemplateSpam(a, { ...b, mint: "m2", name: "Totally Different" }), false, "no shared name token");
});

// ── real production data (panda-pad.vercel.app/discover, 2026-10-03): the same ring as REAL_TEMPLATE_SPAM
// above, relaunched under names that share no word at all — filterTemplateSpam's name-token requirement
// can't key off anything here, so only the stats themselves (same shape: +1369%, ~49K cap, ~10.1K volume)
// give it away. ──────────────────────────────────────────────────────────────────────────────────────
const REAL_STATS_RING = [
  coin({ ticker: "CHILLMASK", name: "Chill Mask", creator: "creatorD", changePct: 1369, marketCap: 49_200, volume24h: 10_180 }),
  coin({ ticker: "HOOKEDGUY", name: "Hooked Guy", creator: "creatorE", changePct: 1369, marketCap: 49_050, volume24h: 10_140 }),
  coin({ ticker: "SKI", name: "Ski", creator: "creatorF", changePct: 1369, marketCap: 48_990, volume24h: 10_120 }),
  coin({ ticker: "VRAXWEEN", name: "Vraxween", creator: "creatorG", changePct: 1369, marketCap: 48_900, volume24h: 10_095 }),
  coin({ ticker: "HULKINU", name: "Hulk Inu", creator: "creatorH", changePct: 1369, marketCap: 48_850, volume24h: 10_070 }),
];

test("real data: filterTemplateSpam misses a renamed ring with no shared name token", () => {
  const out = filterTemplateSpam(REAL_STATS_RING);
  assert.equal(out.length, REAL_STATS_RING.length, "no two coins share a name token, so the name-gated check can't cluster them");
});

test("filterStatsOnlyRing collapses a 3+ cluster with near-identical change%, market cap and volume to the top-volume coin, even with unrelated names and creators", () => {
  const out = filterStatsOnlyRing(REAL_STATS_RING);
  assert.deepEqual(out.map((c) => c.ticker), ["CHILLMASK"]);
});

// ── real production data (panda-pad.vercel.app/discover, Tendencia sort, 2026-10-03): a live instance
// of the same ring, caught live-testing the fix above — HULKINU/PMASK/SEAPUG and LP/PM/MONAWEEN, each
// trio spanning MORE than 3 absolute percentage points pairwise (e.g. HULKINU 1363% vs SEAPUG 1354%, a
// 9-point gap), which a pure absolute tolerance missed even though they're under 1% apart in RELATIVE
// terms — exactly what closeEnoughPct's ratio fallback exists for. ─────────────────────────────────────
const REAL_DISCOVER_RING_A = [
  coin({ ticker: "HULKINU", name: "HULKINU", creator: "creatorI", changePct: 1363, marketCap: 49_100, volume24h: 10_100 }),
  coin({ ticker: "PMASK", name: "Ponsmask", creator: "creatorJ", changePct: 1357, marketCap: 49_000, volume24h: 10_100 }),
  coin({ ticker: "SEAPUG", name: "SEAPUG", creator: "creatorK", changePct: 1354, marketCap: 49_000, volume24h: 10_100 }),
];
const REAL_DISCOVER_RING_B = [
  coin({ ticker: "LP", name: "Laser Purr", creator: "creatorL", changePct: 403, marketCap: 49_100, volume24h: 10_100 }),
  coin({ ticker: "PM", name: "PUMPMASK", creator: "creatorM", changePct: 401, marketCap: 49_000, volume24h: 10_100 }),
  coin({ ticker: "MONAWEEN", name: "Mona Pepe Ween", creator: "creatorN", changePct: 397, marketCap: 49_100, volume24h: 10_200 }),
];

test("real data: filterStatsOnlyRing catches a ring even when its change% spans more than the absolute tolerance, via the relative fallback", () => {
  assert.deepEqual(filterStatsOnlyRing(REAL_DISCOVER_RING_A).map((c) => c.ticker), ["HULKINU"]);
  assert.deepEqual(filterStatsOnlyRing(REAL_DISCOVER_RING_B).map((c) => c.ticker), ["MONAWEEN"]); // highest volume of the three ($10.2K vs $10.1K)
});

test("filterStatsOnlyRing never drops a lone pair (minClusterSize gate) or coins whose stats are genuinely apart", () => {
  const a = coin({ ticker: "A", changePct: 50, marketCap: 50_000, volume24h: 10_000 });
  const b = coin({ ticker: "B", changePct: 50.5, marketCap: 50_200, volume24h: 10_100 }); // close enough to match A alone
  const c = coin({ ticker: "C", changePct: 900, marketCap: 1_000_000, volume24h: 500_000 }); // far apart
  const out = filterStatsOnlyRing([a, b, c]);
  assert.deepEqual(out.map((x) => x.ticker).sort(), ["A", "B", "C"], "a 2-coin match alone isn't enough to drop anything");
});

// ── real production data (panda-pad.vercel.app/discover, 2026-10-05): the same ring again, now varying its
// REPORTED 24h change per coin on purpose (+400% to +1,300%+) so filterStatsOnlyRing's three-metrics-at-once
// match never fires — but market cap and volume are still reused almost exactly. ──────────────────────────
const REAL_CAP_VOLUME_RING = [
  coin({ ticker: "BUL", name: "Bul", creator: "creatorO", changePct: 412, marketCap: 49_100, volume24h: 10_120 }),
  coin({ ticker: "PROG", name: "Prog", creator: "creatorP", changePct: 650, marketCap: 49_050, volume24h: 10_140 }),
  coin({ ticker: "PEPANCE", name: "Pepance", creator: "creatorQ", changePct: 980, marketCap: 48_980, volume24h: 10_095 }),
  coin({ ticker: "GCG", name: "GCG", creator: "creatorR", changePct: 1310, marketCap: 49_000, volume24h: 10_150 }),
];

test("real data: filterStatsOnlyRing misses a ring whose change% is deliberately spread out, even with matching cap and volume", () => {
  const out = filterStatsOnlyRing(REAL_CAP_VOLUME_RING);
  assert.equal(out.length, REAL_CAP_VOLUME_RING.length, "change% (412..1310) is far outside the tolerance/ratio gate, so nothing clusters on it");
});

test("filterCapVolumeRing collapses a 4+ cluster matching only on market cap and volume to the top-volume coin, ignoring change% entirely", () => {
  const out = filterCapVolumeRing(REAL_CAP_VOLUME_RING);
  assert.deepEqual(out.map((c) => c.ticker), ["GCG"]); // $10,150 is the highest volume of the four
});

test("filterCapVolumeRing never drops a cluster smaller than minClusterSize (4), even with cap/volume as close as the real ring", () => {
  const a = coin({ ticker: "A", marketCap: 49_000, volume24h: 10_100 });
  const b = coin({ ticker: "B", marketCap: 49_050, volume24h: 10_120 });
  const c = coin({ ticker: "C", marketCap: 48_980, volume24h: 10_095 });
  const out = filterCapVolumeRing([a, b, c]);
  assert.deepEqual(out.map((x) => x.ticker).sort(), ["A", "B", "C"], "only 3 coins match — one short of the 4-coin minimum this check requires");
});

test("filterCapVolumeRing never touches a coin whose market cap or volume are genuinely apart from the ring it drops", () => {
  const unrelated = coin({ ticker: "UNRELATED", marketCap: 500_000, volume24h: 250_000 }); // a real, unrelated coin
  const out = filterCapVolumeRing([...REAL_CAP_VOLUME_RING, unrelated]);
  assert.deepEqual(out.map((x) => x.ticker).sort(), ["GCG", "UNRELATED"]);
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
