import { test } from "node:test";
import assert from "node:assert/strict";
import { firstFunderCheck } from "./anti-abuse";

// serverRpcUrl() falls back to a public Solana RPC in test env (no SOLANA_RPC_URL), which isn't a Helius URL —
// so heliusApiKeyFromRpcUrl always returns null here, UNLESS the environment under test happens to set a real
// Helius SOLANA_RPC_URL. Assert only what's true either way; the Helius-key-present path is covered by hitting
// the fetch mock directly below.
const REFERRED = "35gHwjqiTsPPCzLpQhCcJZBGiUR9TSDYNPuxUdvERVkh";
const REFERRER = "DCZaeTXLDwkwE4a8xayS3o9hCiPwgH1deotvyS5VEE6n";

test("firstFunderCheck: 'unknown' without a Helius RPC configured — never blocks or wrongly clears a referral", async () => {
  const original = process.env.SOLANA_RPC_URL;
  process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
  try {
    assert.equal(await firstFunderCheck(REFERRED, REFERRER), "unknown");
  } finally {
    if (original === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = original;
  }
});

test("firstFunderCheck: with a Helius RPC, 'self_funded' when the first incoming SOL came from the referrer", async () => {
  const original = process.env.SOLANA_RPC_URL;
  process.env.SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
  try {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => [
        { nativeTransfers: [] }, // no SOL moved in this one — skipped
        { nativeTransfers: [{ fromUserAccount: REFERRER, toUserAccount: REFERRED, amount: 1_000_000 }] },
        { nativeTransfers: [{ fromUserAccount: "SomeoneElse", toUserAccount: REFERRED, amount: 500 }] }, // later — irrelevant, first one already decided it
      ],
    })) as unknown as typeof fetch;
    assert.equal(await firstFunderCheck(REFERRED, REFERRER, fetchImpl), "self_funded");
  } finally {
    if (original === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = original;
  }
});

test("firstFunderCheck: 'clean' when the first incoming SOL is from someone else", async () => {
  const original = process.env.SOLANA_RPC_URL;
  process.env.SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
  try {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => [{ nativeTransfers: [{ fromUserAccount: "SomeoneElse", toUserAccount: REFERRED, amount: 500 }] }],
    })) as unknown as typeof fetch;
    assert.equal(await firstFunderCheck(REFERRED, REFERRER, fetchImpl), "clean");
  } finally {
    if (original === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = original;
  }
});

test("firstFunderCheck: 'unknown' on a failed call or a body with no relevant transfer at all", async () => {
  const original = process.env.SOLANA_RPC_URL;
  process.env.SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=test-key";
  try {
    assert.equal(await firstFunderCheck(REFERRED, REFERRER, (async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch), "unknown");
    assert.equal(await firstFunderCheck(REFERRED, REFERRER, (async () => ({ ok: true, json: async () => [{ nativeTransfers: [] }] })) as unknown as typeof fetch), "unknown");
    assert.equal(await firstFunderCheck(REFERRED, REFERRER, (async () => { throw new Error("network"); }) as unknown as typeof fetch), "unknown");
  } finally {
    if (original === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = original;
  }
});
