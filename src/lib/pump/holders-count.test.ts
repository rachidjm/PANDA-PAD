import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchHolderCount } from "./holders-count";

const HELIUS_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
const MINT = "3eJExN3JCpXjADDKSqs3uV9N1kR2fBQiUrtP4zBwYX68";

test("reads result.total from a real getTokenAccounts response", async () => {
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string);
    assert.equal(body.method, "getTokenAccounts");
    assert.equal(body.params.mint, MINT);
    return { ok: true, json: async () => ({ result: { total: 1234, token_accounts: [] } }) };
  }) as unknown as typeof fetch;
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, fetchImpl), 1234);
});

test("null when the RPC isn't a Helius one — this method is Helius-specific", async () => {
  assert.equal(await fetchHolderCount(MINT, "https://api.mainnet-beta.solana.com"), null);
});

test("null (never throws) on a non-OK response, a malformed body, or a network failure", async () => {
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch), null);
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, (async () => ({ ok: true, json: async () => ({ result: { total: "not a number" } }) })) as unknown as typeof fetch), null);
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, (async () => { throw new Error("network"); }) as unknown as typeof fetch), null);
});
