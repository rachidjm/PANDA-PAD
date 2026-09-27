import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchSwapSignatures, heliusApiKeyFromRpcUrl } from "./helius";

const WALLET = "35gHwjqiTsPPCzLpQhCcJZBGiUR9TSDYNPuxUdvERVkh";

test("heliusApiKeyFromRpcUrl: only extracts the key from an actual Helius RPC URL", () => {
  assert.equal(heliusApiKeyFromRpcUrl("https://mainnet.helius-rpc.com/?api-key=abc123"), "abc123");
  assert.equal(heliusApiKeyFromRpcUrl("https://api.mainnet-beta.solana.com"), null);
  assert.equal(heliusApiKeyFromRpcUrl("not a url"), null);
});

test("fetchSwapSignatures: parses signature + timestamp(ms) from a well-formed response", async () => {
  const fakeFetch = (async (url: string | URL) => {
    assert.match(String(url), /^https:\/\/api\.helius\.xyz\/v0\/addresses\/.+\/transactions\?api-key=KEY&type=SWAP&limit=100$/);
    return { ok: true, json: async () => [{ signature: "sig1", timestamp: 1_700_000_000 }, { signature: "sig2", timestamp: 1_700_000_100 }] };
  }) as unknown as typeof fetch;
  const out = await fetchSwapSignatures(WALLET, "KEY", 100, fakeFetch);
  assert.deepEqual(out, [{ signature: "sig1", ts: 1_700_000_000_000 }, { signature: "sig2", ts: 1_700_000_100_000 }]);
});

test("fetchSwapSignatures: null (never throws) on a bad address, a non-OK response, or a malformed body", async () => {
  assert.equal(await fetchSwapSignatures("not-an-address", "KEY"), null);
  assert.equal(await fetchSwapSignatures(WALLET, "KEY", 100, (async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch), null);
  assert.equal(await fetchSwapSignatures(WALLET, "KEY", 100, (async () => ({ ok: true, json: async () => ({ not: "an array" }) })) as unknown as typeof fetch), null);
  assert.equal(await fetchSwapSignatures(WALLET, "KEY", 100, (async () => { throw new Error("network"); }) as unknown as typeof fetch), null);
});

test("fetchSwapSignatures: entries missing a real signature/timestamp are skipped, not crashed on", async () => {
  const fakeFetch = (async () => ({ ok: true, json: async () => [{ signature: "sig1", timestamp: 1 }, { signature: 42, timestamp: 2 }, { signature: "sig3" }] })) as unknown as typeof fetch;
  const out = await fetchSwapSignatures(WALLET, "KEY", 100, fakeFetch);
  assert.deepEqual(out, [{ signature: "sig1", ts: 1000 }]);
});
