import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { memoryLimited, moneyRateGate, rateLimited, rateVerdict, setRateBackendForTests, upstashCredentials, type RateBackend } from "./rate-limit";

const env = process.env as Record<string, string | undefined>;
const realNodeEnv = env.NODE_ENV;
afterEach(() => {
  setRateBackendForTests(undefined);
  env.NODE_ENV = realNodeEnv;
});
let n = 0;
const key = () => `k${++n}-${Math.random()}`;

/** A fake Upstash: counts per key across every caller, like a shared Redis. */
function sharedBackend(): { backend: RateBackend; calls: () => number } {
  const counts = new Map<string, number>();
  let calls = 0;
  return {
    calls: () => calls,
    backend: async (k, limit) => {
      calls++;
      const c = (counts.get(k) ?? 0) + 1;
      counts.set(k, c);
      return c <= limit;
    },
  };
}

test("development without Upstash: the in-memory limiter throttles (everything works locally)", async () => {
  env.NODE_ENV = "development";
  setRateBackendForTests(null);
  const k = key();
  assert.deepEqual([await rateVerdict(k, 2, 60_000, "read"), await rateVerdict(k, 2, 60_000, "read"), await rateVerdict(k, 2, 60_000, "read")], ["ok", "ok", "limited"]);
  const m = key();
  assert.equal(await moneyRateGate(m, 1, 60_000), null, "money routes also work in development without Upstash");
  assert.equal((await moneyRateGate(m, 1, 60_000))?.status, 429);
});

test("with Upstash the counter is SHARED: two callers add up (the in-memory limiter could never do this)", async () => {
  env.NODE_ENV = "production";
  const { backend, calls } = sharedBackend();
  setRateBackendForTests(backend);
  const k = key();
  const results = await Promise.all(Array.from({ length: 6 }, () => rateVerdict(k, 4, 60_000, "money")));
  assert.equal(results.filter((r) => r === "ok").length, 4);
  assert.equal(results.filter((r) => r === "limited").length, 2);
  assert.equal(calls(), 6);
  assert.equal(memoryLimited(k, 1, 60_000), false, "the per-instance counter was never touched");
});

test("FAIL CLOSED: a money route is refused with 503 when Upstash errors — never let through", async () => {
  env.NODE_ENV = "production";
  setRateBackendForTests(async () => {
    throw new Error("upstash down");
  });
  const res = await moneyRateGate(key(), 10, 60_000);
  assert.equal(res?.status, 503);
  assert.equal((await res!.json()).code, "RATE_LIMIT_UNAVAILABLE");
  assert.equal(res!.headers.get("retry-after"), "30");
});

test("FAIL OPEN: a read route keeps working when Upstash errors, throttled by the per-instance limiter meanwhile", async () => {
  env.NODE_ENV = "production";
  setRateBackendForTests(async () => {
    throw new Error("upstash down");
  });
  const k = key();
  assert.equal(await rateLimited(k, 2, 60_000), false);
  assert.equal(await rateLimited(k, 2, 60_000), false);
  assert.equal(await rateLimited(k, 2, 60_000), true, "still throttled per instance, not wide open");
});

test("a hanging Upstash is treated as down after the timeout: money refused, reads served", async () => {
  env.NODE_ENV = "production";
  setRateBackendForTests(() => new Promise<boolean>(() => {}));
  const t0 = Date.now();
  assert.equal((await moneyRateGate(key(), 10, 60_000))?.status, 503);
  assert.ok(Date.now() - t0 < 3_000, "gave up after ~1.5 s");
});

test("after a failure the backend is not asked again for a few seconds (one timeout per outage, not per request)", async () => {
  env.NODE_ENV = "production";
  let calls = 0;
  setRateBackendForTests(async () => {
    calls++;
    throw new Error("boom");
  });
  await moneyRateGate(key(), 10, 60_000);
  await moneyRateGate(key(), 10, 60_000);
  await rateLimited(key(), 10, 60_000);
  assert.equal(calls, 1);
});

test("production with Upstash NOT configured: money is refused (503), reads use the per-instance limiter", async () => {
  env.NODE_ENV = "production";
  setRateBackendForTests(null);
  assert.equal((await moneyRateGate(key(), 10, 60_000))?.status, 503);
  const k = key();
  assert.equal(await rateLimited(k, 1, 60_000), false);
  assert.equal(await rateLimited(k, 1, 60_000), true);
});

test("a route can keep its own 429 body, and gets it only when actually over the limit", async () => {
  env.NODE_ENV = "production";
  setRateBackendForTests(async () => false);
  const res = await moneyRateGate(key(), 1, 60_000, () => NextResponse.json({ error: "custom", code: "RATE_LIMITED" }, { status: 429 }));
  assert.equal(res?.status, 429);
  assert.equal((await res!.json()).code, "RATE_LIMITED");
  setRateBackendForTests(async () => true);
  assert.equal(await moneyRateGate(key(), 1, 60_000, () => NextResponse.json({}, { status: 429 })), null);
});

test("Upstash credentials: either naming works, and both parts are needed", () => {
  assert.deepEqual(upstashCredentials({ UPSTASH_REDIS_REST_URL: "https://a", UPSTASH_REDIS_REST_TOKEN: "t" }), { url: "https://a", token: "t" });
  assert.deepEqual(upstashCredentials({ KV_REST_API_URL: "https://b", KV_REST_API_TOKEN: "u" }), { url: "https://b", token: "u" });
  assert.equal(upstashCredentials({ UPSTASH_REDIS_REST_URL: "https://a" }), null);
  assert.equal(upstashCredentials({}), null);
});

// ── every call site follows the policy (a static guard, so a new route can't quietly skip it) ───────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
const SRC = path.join(process.cwd(), "src");
const norm = (p: string) => p.split(path.sep).join("/");

test("the limiter is async everywhere: no call site forgets to await it (an un-awaited Promise is always truthy = always 'limited')", () => {
  const bad = sourceFiles(SRC).filter((f) => !norm(f).endsWith("src/lib/rate-limit.ts")).flatMap((f) => (readFileSync(f, "utf8").match(/(?<!await |function |import \{[^}]*)\brateLimited\(/g) ?? []).map(() => norm(f)));
  assert.deepEqual(bad, []);
});

/** Routes that move money, create coins/assets or place orders: they must use the fail-closed gate, never the fail-open one. */
const MONEY_FILES = [
  "app/api/jupiter/swap/route.ts", "app/api/pump/buy/route.ts", "app/api/pump/sell/route.ts", "app/api/pump/create/route.ts",
  "app/api/otc/launch/build/route.ts", "app/api/otc/metadata/route.ts", "app/api/otc/register/route.ts",
  "app/api/rewards/claim/route.ts", "app/api/airdrop/claim/route.ts", "app/api/nft/prepare/route.ts", "app/api/nft/confirm/route.ts",
  "lib/market/route-helpers.ts", "lib/strategy/route.ts",
];
test("money routes use the FAIL-CLOSED gate and never the fail-open one", () => {
  for (const f of MONEY_FILES) {
    const src = readFileSync(path.join(SRC, f), "utf8");
    assert.ok(/moneyRateGate\(/.test(src), `${f} must call moneyRateGate`);
    assert.ok(!/rateLimited\(/.test(src.replace(/import[^\n]*\n/g, "")), `${f} must not use the fail-open rateLimited`);
  }
  const rpc = readFileSync(path.join(SRC, "app/api/rpc/route.ts"), "utf8");
  assert.ok(/rateVerdict\([^\n]*"money"\)/.test(rpc), "sending a transaction through /api/rpc is a money action");
});

test("admin routes are FAIL-OPEN on purpose: an emergency pause must never be blockable by a Redis outage", () => {
  const pause = readFileSync(path.join(SRC, "app/api/admin/pause/route.ts"), "utf8");
  assert.ok(/await rateLimited\(/.test(pause) && !/moneyRateGate/.test(pause));
});
