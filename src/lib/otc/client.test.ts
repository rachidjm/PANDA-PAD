import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeteoraLaunch, registerCoin, uploadMetadata, OtcApiError } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("uploadMetadata posts multipart/form-data to the documented endpoint and returns metadataUri", async (t) => {
  let capturedUrl = "";
  let capturedForm: unknown = null;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    capturedUrl = String(url);
    capturedForm = init.body;
    return jsonResponse(200, { metadataUri: "https://cdn/x.json" });
  });

  const result = await uploadMetadata({
    file: new Blob(["fake-image"], { type: "image/png" }),
    filename: "coin.png",
    name: "Coin",
    symbol: "COIN",
    description: "desc",
  });

  assert.equal(capturedUrl, "https://otcdesks.cash/api/ipfs");
  assert.ok(capturedForm);
  assert.equal((capturedForm as FormData).get("name"), "Coin");
  assert.equal(result.metadataUri, "https://cdn/x.json");
});

test("uploadMetadata surfaces OTC's real error message on failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(400, { error: "Missing name or symbol." }));
  await assert.rejects(
    uploadMetadata({ file: new Blob(["x"]), filename: "a.png", name: "", symbol: "", description: "" }),
    (err: unknown) => err instanceof OtcApiError && err.message === "Missing name or symbol." && err.status === 400
  );
});

test("buildMeteoraLaunch sends exactly the documented fields, with mode/buy defaults", async (t) => {
  let captured: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    captured = JSON.parse(init.body as string);
    return jsonResponse(200, { transactions: ["a", "b"], config: "cfg", blockhash: "bh", lastValidBlockHeight: 42, quoteUsd: 1.5 });
  });

  const result = await buildMeteoraLaunch({ mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", quoteMint: "Q" });

  assert.deepEqual(captured, { mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", quoteMint: "Q", mode: "low", buy: "0" });
  assert.deepEqual(result.transactions, ["a", "b"]);
  assert.equal(result.config, "cfg");
  assert.equal(result.lastValidBlockHeight, 42);
});

test("buildMeteoraLaunch propagates a 503 (unpriceable quote) as-is", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(503, { error: "The quote could not be priced." }));
  await assert.rejects(
    buildMeteoraLaunch({ mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", quoteMint: "Q" }),
    (err: unknown) => err instanceof OtcApiError && err.status === 503
  );
});

test("buildMeteoraLaunch rejects an incomplete response rather than trusting it", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(200, { transactions: ["only-one"] }));
  await assert.rejects(buildMeteoraLaunch({ mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", quoteMint: "Q" }), OtcApiError);
});

test("registerCoin: a 409 is reported as notIndexedYet, not a hard failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(409, { error: "not indexed" }));
  const result = await registerCoin({
    mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", createTx: "sig",
    pairMint: "Q", pairSymbol: "Q", rewardMint: "Q", rewardSymbol: "Q", meteoraConfig: "cfg",
  });
  assert.deepEqual(result, { ok: false, notIndexedYet: true });
});

test("registerCoin: success and other failures are reported distinctly", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(200, {}));
  const ok = await registerCoin({ mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", createTx: "sig", pairMint: "Q", pairSymbol: "Q", rewardMint: "Q", rewardSymbol: "Q", meteoraConfig: "cfg" });
  assert.deepEqual(ok, { ok: true });

  t.mock.method(globalThis, "fetch", async () => jsonResponse(500, { error: "Could not build the launch." }));
  const fail = await registerCoin({ mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", createTx: "sig", pairMint: "Q", pairSymbol: "Q", rewardMint: "Q", rewardSymbol: "Q", meteoraConfig: "cfg" });
  assert.deepEqual(fail, { ok: false, notIndexedYet: false, error: "Could not build the launch." });
});

test("no OTC API key is ever sent — the docs say the API needs none", async (t) => {
  let headers: Headers | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    headers = new Headers(init.headers);
    return jsonResponse(200, { transactions: ["a", "b"], config: "c", blockhash: "b", lastValidBlockHeight: 1 });
  });
  await buildMeteoraLaunch({ mint: "M", name: "N", symbol: "S", uri: "U", creator: "C", quoteMint: "Q" });
  assert.equal(headers!.has("x-api-key"), false);
  assert.equal(headers!.has("authorization"), false);
});
