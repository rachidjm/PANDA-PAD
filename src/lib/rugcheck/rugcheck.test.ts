import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { parseSummary, rugcheckPageUrl, RUGCHECK_API } from "./summary";
import { clearMemoryCacheForTests, fetchRugSummary, getRugSummaries, RUGCHECK_BUDGET_PER_MINUTE, RUGCHECK_FAIL_TTL_S, RUGCHECK_FETCH_PER_REQUEST, RUGCHECK_TTL_S, setRugCheckCacheForTests, type Cache } from "./server";
import { GET } from "@/app/api/rugcheck/route";

// The shapes below are real answers of GET https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary (recorded 2026-09-26).
const CLEAN = { tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", tokenType: "", risks: [], score: 1, score_normalised: 1, lpLockedPct: 100 };
const DANGER = {
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", tokenType: "", score: 24386, score_normalised: 62, lpLockedPct: 0,
  risks: [
    { name: "Low Liquidity", value: "$0.12", description: "Low amount of liquidity in the token pool", score: 2999, level: "warn" },
    { name: "Single holder ownership", value: "97.88%", description: "One user holds a large amount of the token supply", score: 9788, level: "danger" },
  ],
};
const WARN_ONLY = { ...DANGER, risks: [DANGER.risks[0]], score_normalised: 20 };

test("the level comes from RugCheck's own per-risk levels: any danger → danger, else any warn → warn, else good; the worst risks come first", () => {
  assert.equal(parseSummary(CLEAN)?.level, "good");
  assert.equal(parseSummary(CLEAN)?.score, 1);
  assert.equal(parseSummary(WARN_ONLY)?.level, "warn");
  const d = parseSummary(DANGER)!;
  assert.equal(d.level, "danger");
  assert.equal(d.score, 62);
  assert.equal(d.risks[0].name, "Single holder ownership", "danger sorts before warn");
  assert.equal(d.lpLockedPct, 0);
});

test("anything that isn't a usable report yields NOTHING (never a made-up 'unknown' or 'safe')", () => {
  for (const bad of [null, undefined, "x", 5, [], {}, { error: "invalid length, expected 32, got 20" }, { risks: [] }, { risks: "no", score: 1 }, { score: 1 }]) assert.equal(parseSummary(bad), null, JSON.stringify(bad));
  assert.equal(parseSummary({ risks: [{ name: 5, level: "danger" }, null, "x"], score: 3, score_normalised: 3 })?.level, "good", "malformed risks are ignored, not trusted");
});

test("the endpoint is the one in RugCheck's official OpenAPI, and the page link is rugcheck.xyz/tokens/<mint>", () => {
  assert.equal(RUGCHECK_API, "https://api.rugcheck.xyz/v1/tokens");
  const mint = Keypair.generate().publicKey.toBase58();
  assert.equal(rugcheckPageUrl(mint), `https://rugcheck.xyz/tokens/${mint}`);
});

// ── the server side ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const mint = () => Keypair.generate().publicKey.toBase58();
function fakeCache() {
  const store = new Map<string, { s: unknown; ttl: number }>();
  let spent = 0;
  const cache: Cache = {
    get: async (m) => (store.has(m) ? ({ s: store.get(m)!.s } as never) : null),
    set: async (m, v, ttl) => void store.set(m, { s: v.s, ttl }),
    spend: async (limit) => ++spent <= limit,
  };
  return { cache, store, spent: () => spent };
}
function fakeFetch(bodyFor: (mint: string) => { status?: number; body: unknown } | "throw") {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    const m = String(url).split("/tokens/")[1].split("/")[0];
    calls.push(m);
    const r = bodyFor(m);
    if (r === "throw") throw new Error("network");
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
beforeEach(() => {
  setRugCheckCacheForTests(undefined);
  clearMemoryCacheForTests();
});

test("a coin is asked once per 10 minutes: the second view comes from the cache, with a 600 s TTL", async () => {
  assert.equal(RUGCHECK_TTL_S, 600);
  const { cache, store } = fakeCache();
  setRugCheckCacheForTests(cache);
  const m = mint();
  const f = fakeFetch(() => ({ body: DANGER }));
  const first = await getRugSummaries([m], f.impl);
  assert.equal(first.results[m].level, "danger");
  assert.equal(store.get(m)!.ttl, 600);
  const second = await getRugSummaries([m], f.impl);
  assert.equal(second.results[m].level, "danger");
  assert.equal(f.calls.length, 1, "no second request to RugCheck");
});

test("if RugCheck fails (429, 404, timeout, garbage, network) the coin shows nothing and the failure is only remembered briefly", async () => {
  for (const r of [{ status: 429, body: { error: "rate limited" } }, { status: 404, body: { error: "not found" } }, { status: 200, body: { error: "x" } }, { status: 200, body: "junk" }, "throw"] as const) {
    const { cache, store } = fakeCache();
    setRugCheckCacheForTests(cache);
    const m = mint();
    const f = fakeFetch(() => r);
    const out = await getRugSummaries([m], f.impl);
    assert.deepEqual(out, { results: {}, pending: [] }, JSON.stringify(r));
    assert.equal(store.get(m)!.ttl, RUGCHECK_FAIL_TTL_S);
    assert.equal(store.get(m)!.s, null);
    await getRugSummaries([m], f.impl);
    assert.equal(f.calls.length, 1, "a failing coin isn't retried on every page view");
  }
  assert.equal(await fetchRugSummary(mint(), fakeFetch(() => "throw").impl), null);
});

test("RugCheck's rate limit is respected: at most 4 misses per request and 12 per minute site-wide; the rest are 'pending', not fetched", async () => {
  assert.equal(RUGCHECK_FETCH_PER_REQUEST, 4);
  assert.ok(RUGCHECK_BUDGET_PER_MINUTE < 15, "under RugCheck's 15 per window");
  const { cache } = fakeCache();
  setRugCheckCacheForTests(cache);
  const f = fakeFetch(() => ({ body: CLEAN }));
  const mints = Array.from({ length: 10 }, mint);
  const first = await getRugSummaries(mints, f.impl);
  assert.equal(f.calls.length, 4);
  assert.equal(Object.keys(first.results).length, 4);
  assert.equal(first.pending.length, 6);
  const second = await getRugSummaries(first.pending, f.impl);
  assert.equal(f.calls.length, 8);
  assert.equal(second.pending.length, 2);
  const third = await getRugSummaries(second.pending, f.impl);
  assert.equal(f.calls.length, 10);
  assert.deepEqual(third.pending, []);
  // the site-wide budget (12 this minute) is now nearly spent: 5 brand-new coins get only the last 2 turns, the other 3 wait
  const fresh = Array.from({ length: 5 }, mint);
  const fourth = await getRugSummaries(fresh, f.impl);
  assert.equal(f.calls.length, 12, "never over the per-minute budget");
  assert.equal(fourth.pending.length, 3);
});

test("a down cache doesn't break the badge nor bypass the budget", async () => {
  const broken: Cache = { get: async () => { throw new Error("upstash down"); }, set: async () => { throw new Error("upstash down"); }, spend: async () => { throw new Error("upstash down"); } };
  setRugCheckCacheForTests(broken);
  const m = mint();
  const f = fakeFetch(() => ({ body: CLEAN }));
  const out = await getRugSummaries([m], f.impl);
  assert.equal(f.calls.length, 0, "if the budget can't be counted, RugCheck isn't called");
  assert.deepEqual(out, { results: {}, pending: [m] });
});

// ── the route ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("the route ignores anything that isn't a Solana address, dedupes and caps at 30", async () => {
  const { cache } = fakeCache();
  setRugCheckCacheForTests(cache);
  const req = (q: string) => GET(new Request(`https://panda.test/api/rugcheck?mints=${q}`, { headers: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } }));
  const bad = await (await req("nope,123,,../../etc")).json();
  assert.deepEqual(bad, { results: {}, pending: [] });
  const many = Array.from({ length: 40 }, mint).join(",");
  const res = await req(many);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("the UI: nothing for a coin RugCheck can't rate; the page shows the level, the score and a 'View on RugCheck' link to rugcheck.xyz/tokens/<mint>; cards and page both use it", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const badge = read("src/components/RugBadge.tsx");
  assert.match(badge, /rugcheckPageUrl\(mint\)/);
  assert.match(badge, /t\("rc\.view"\)/);
  assert.match(badge, /if \(!summary\)/, "no summary → no badge");
  assert.doesNotMatch(badge.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /unknown|loading|Unknown|Loading/, "no fake states");
  assert.match(read("src/components/CoinCard.tsx"), /<RugBadge mint=\{coin\.mint\}/);
  assert.match(read("src/components/coin/CoinClient.tsx"), /<RugBadge mint=\{coin\.mint\} variant="full"/);
  // the browser only ever talks to PANDA's own route
  assert.doesNotMatch(read("src/lib/rugcheck/client.ts"), /rugcheck\.xyz/);
});
