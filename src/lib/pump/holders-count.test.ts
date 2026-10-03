import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchHolderCount } from "./holders-count";

const HELIUS_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
const MINT = "3eJExN3JCpXjADDKSqs3uV9N1kR2fBQiUrtP4zBwYX68";

function page(accounts: number, cursor?: string) {
  return { ok: true, json: async () => ({ result: { token_accounts: Array.from({ length: accounts }, () => ({})), cursor } }) };
}

test("counts real returned accounts on a single short page (never Helius's own 'total', which is just this page's size)", async () => {
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string);
    assert.equal(body.method, "getTokenAccounts");
    assert.equal(body.params.mint, MINT);
    assert.equal(body.params.options.showZeroBalance, false);
    return page(3);
  }) as unknown as typeof fetch;
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, fetchImpl), 3);
});

test("pages through with cursor and sums real accounts until a short page", async () => {
  let call = 0;
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string);
    call++;
    if (call === 1) {
      assert.equal(body.params.cursor, undefined);
      return page(1000, "cursor-1");
    }
    assert.equal(body.params.cursor, "cursor-1");
    return page(234);
  }) as unknown as typeof fetch;
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, fetchImpl), 1234);
});

test("a token with more holders than MAX_PAGES allows: null, never a count that looks exact but is really a floor", async () => {
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string);
    return page(1000, `cursor-${body.params.cursor ?? "0"}-next`);
  }) as unknown as typeof fetch;
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, fetchImpl), null);
});

test("a full page with no cursor to continue stops there rather than looping forever", async () => {
  const fetchImpl = (async () => page(1000, undefined)) as unknown as typeof fetch;
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, fetchImpl), 1000);
});

test("null when the RPC isn't a Helius one — this method is Helius-specific", async () => {
  assert.equal(await fetchHolderCount(MINT, "https://api.mainnet-beta.solana.com"), null);
});

test("null (never throws) on a non-OK response, a malformed body, or a network failure", async () => {
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch), null);
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, (async () => ({ ok: true, json: async () => ({ result: { token_accounts: "not an array" } }) })) as unknown as typeof fetch), null);
  assert.equal(await fetchHolderCount(MINT, HELIUS_URL, (async () => { throw new Error("network"); }) as unknown as typeof fetch), null);
});
