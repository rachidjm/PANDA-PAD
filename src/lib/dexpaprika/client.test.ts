import { test } from "node:test";
import assert from "node:assert/strict";
import { toChartCandles, fetchPoolOhlcvDexPaprika } from "./client";

const RAW = [
  { time_open: "2026-09-10T00:00:00Z", time_close: "2026-09-11T00:00:00Z", open: 1, high: 1.2, low: 0.9, close: 1.1, volume: 1000 },
  { time_open: "2026-09-11T00:00:00Z", time_close: "2026-09-12T00:00:00Z", open: 1.1, high: 1.3, low: 1.0, close: 1.2, volume: 2000 },
];

test("toChartCandles: real DexPaprika shape maps time_open (ISO) to unix seconds, keeps close, sorted ascending", () => {
  const out = toChartCandles(RAW);
  assert.deepEqual(out, [
    { time: Math.floor(new Date("2026-09-10T00:00:00Z").getTime() / 1000), close: 1.1 },
    { time: Math.floor(new Date("2026-09-11T00:00:00Z").getTime() / 1000), close: 1.2 },
  ]);
});

test("toChartCandles: drops malformed entries (bad date, non-finite or non-positive close) instead of throwing", () => {
  const out = toChartCandles([
    ...RAW,
    { time_open: "not-a-date", time_close: "x", open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time_open: "2026-09-12T00:00:00Z", time_close: "x", open: 1, high: 1, low: 1, close: 0, volume: 1 },
    { time_open: "2026-09-13T00:00:00Z", time_close: "x", open: 1, high: 1, low: 1, close: NaN, volume: 1 },
  ]);
  assert.equal(out.length, 2);
});

test("toChartCandles: re-sorts out-of-order input", () => {
  const out = toChartCandles([RAW[1], RAW[0]]);
  assert.ok(out[0].time < out[1].time);
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

test("fetchPoolOhlcvDexPaprika: a real 200 response maps to candles; a non-200 or malformed body resolves to [] rather than throwing", async () => {
  const ok = await fetchPoolOhlcvDexPaprika("pool", { start: "-24h", interval: "1h", limit: 24 }, undefined, fakeFetch(200, RAW));
  assert.equal(ok.length, 2);

  assert.deepEqual(await fetchPoolOhlcvDexPaprika("pool", { start: "-24h", interval: "1h", limit: 24 }, undefined, fakeFetch(429, {})), []);
  assert.deepEqual(await fetchPoolOhlcvDexPaprika("pool", { start: "-24h", interval: "1h", limit: 24 }, undefined, fakeFetch(403, { error: "plan" })), []);
  assert.deepEqual(await fetchPoolOhlcvDexPaprika("pool", { start: "-24h", interval: "1h", limit: 24 }, undefined, fakeFetch(200, { not: "an array" })), []);
});

test("fetchPoolOhlcvDexPaprika: a thrown network error (timeout, DNS, ...) also resolves to [] — never propagates", async () => {
  const throwing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.deepEqual(await fetchPoolOhlcvDexPaprika("pool", { start: "-24h", interval: "1h", limit: 24 }, undefined, throwing), []);
});

test("fetchPoolOhlcvDexPaprika: sends the key raw in the Authorization header (no 'Bearer'), per DexPaprika's own docs", async () => {
  let seenAuth: string | null = null;
  const capturing = (async (_url: string, init?: RequestInit) => {
    seenAuth = (init?.headers as Record<string, string>)?.Authorization ?? null;
    return new Response(JSON.stringify(RAW), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchPoolOhlcvDexPaprika("pool", { start: "-7d", interval: "1h", limit: 168 }, "api_test123", capturing);
  assert.equal(seenAuth, "api_test123");
});
