import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { clearVerificationMemoryCacheForTests, getJupiterVerifications, setVerificationCacheForTests } from "./verification-cache";

const mint = () => Keypair.generate().publicKey.toBase58();

function fakeCache() {
  const store = new Map<string, { verified: boolean; liquidityUsd?: number }>();
  return {
    store,
    cache: {
      async get(m: string) {
        return store.get(m) ?? null;
      },
      async set(m: string, v: { verified: boolean; liquidityUsd?: number }) {
        store.set(m, v);
      },
    },
  };
}

function fakeFetch(tokens: Record<string, { isVerified?: boolean; liquidity?: number }>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const q = new URL(url).searchParams.get("query") || "";
    const ids = q.split(",");
    const body = ids.filter((id) => tokens[id]).map((id) => ({ id, ...tokens[id] }));
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

beforeEach(() => {
  setVerificationCacheForTests(undefined);
  clearVerificationMemoryCacheForTests();
});

test("verified and its liquidity come through from Jupiter, and are cached for the next call", async () => {
  const { cache, store } = fakeCache();
  setVerificationCacheForTests(cache);
  const m = mint();
  const f = fakeFetch({ [m]: { isVerified: true, liquidity: 42_000 } });
  const first = await getJupiterVerifications([m], f.impl);
  assert.deepEqual(first.get(m), { verified: true, liquidityUsd: 42_000 });
  assert.deepEqual(store.get(m), { verified: true, liquidityUsd: 42_000 });

  const second = await getJupiterVerifications([m], f.impl);
  assert.deepEqual(second.get(m), { verified: true, liquidityUsd: 42_000 });
  assert.equal(f.calls.length, 1, "the second lookup is served from the cache");
});

test("a mint Jupiter doesn't know is recorded as unverified, not retried every time", async () => {
  const { cache, store } = fakeCache();
  setVerificationCacheForTests(cache);
  const m = mint();
  const f = fakeFetch({});
  const first = await getJupiterVerifications([m], f.impl);
  assert.deepEqual(first.get(m), { verified: false, liquidityUsd: undefined });
  assert.deepEqual(store.get(m), { verified: false, liquidityUsd: undefined });

  await getJupiterVerifications([m], f.impl);
  assert.equal(f.calls.length, 1, "unknown-to-Jupiter is cached too, not re-asked every search");
});

test("a Jupiter outage never throws — every mint just comes back unverified this round", async () => {
  const { cache } = fakeCache();
  setVerificationCacheForTests(cache);
  const m = mint();
  const f = async () => {
    throw new Error("network down");
  };
  const result = await getJupiterVerifications([m], f as unknown as typeof fetch);
  assert.deepEqual(result.get(m), { verified: false, liquidityUsd: undefined }, "never a guessed 'verified', and nothing throws");
});

test("no mints is a no-op — never calls Jupiter", async () => {
  const f = fakeFetch({});
  const result = await getJupiterVerifications([], f.impl);
  assert.equal(result.size, 0);
  assert.equal(f.calls.length, 0);
});
