import { test } from "node:test";
import assert from "node:assert/strict";
import { getChartCache, setChartCache, isFresh } from "./cache";

test("isFresh: true right after fetching, false once the timeframe's own TTL has passed", () => {
  const now = Date.now();
  assert.equal(isFresh({ candles: [], fetchedAt: now, source: "gecko" }, "1m"), true);
  assert.equal(isFresh({ candles: [], fetchedAt: now - 60_000, source: "gecko" }, "1m"), false); // 1m's TTL is 20s
  assert.equal(isFresh({ candles: [], fetchedAt: now - 60_000, source: "gecko" }, "30d"), true); // 30d's TTL is 30min
});

test("without Upstash configured, get/set never throw — reads miss, writes are a no-op (same fail-open convention as the rest of the app's caches)", async () => {
  const before = process.env.UPSTASH_REDIS_REST_URL;
  const beforeToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  try {
    assert.equal(await getChartCache("pool", "1h"), null);
    await setChartCache("pool", "1h", { candles: [{ time: 1, close: 1 }], fetchedAt: Date.now(), source: "gecko" });
  } finally {
    if (before !== undefined) process.env.UPSTASH_REDIS_REST_URL = before;
    if (beforeToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = beforeToken;
  }
});
