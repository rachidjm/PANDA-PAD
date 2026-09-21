import { test } from "node:test";
import assert from "node:assert/strict";
import { bestImage, pumpImageUrl, withBestImage } from "./coin-image";

const PUMP = "2GFNra5dVHehpKLEpKDCzg1PhCTEhqqocPDGJD29pump";
const OLD_PUMP = "Ek9aruebkTqReR8aLYxaVqx6bdGjQqXw7q5tXNe3vD17"; // an older Pump.fun coin: no "pump" suffix, but its source says so

test("a Pump.fun coin with no picture gets Pump.fun's own image CDN", () => {
  assert.equal(bestImage({ mint: PUMP, source: "pump-fun" }), pumpImageUrl(PUMP));
  assert.equal(bestImage({ mint: OLD_PUMP, source: "pumpswap" }), pumpImageUrl(OLD_PUMP));
  assert.equal(bestImage({ mint: PUMP, source: "other" }), pumpImageUrl(PUMP)); // recognised by its address
});

test("a dead or throttled IPFS gateway link is replaced for Pump.fun coins", () => {
  for (const host of ["cf-ipfs.com", "ipfs.io", "cloudflare-ipfs.com", "gateway.pinata.cloud", "dweb.link"]) {
    assert.equal(bestImage({ mint: PUMP, source: "pump-fun", image: `https://${host}/ipfs/QmWHtwgYLNzwKBZAw8KveX9AaGtoCnKmMKwKKdBqxbmkXk` }), pumpImageUrl(PUMP), host);
  }
});

test("pictures that already work are left alone", () => {
  const dex = "https://cdn.dexscreener.com/cms/images/OFKUO9fn7VhhpOFO?width=800";
  assert.equal(bestImage({ mint: PUMP, source: "pump-fun", image: dex }), dex);
  const other = "https://ipfs.io/ipfs/QmX";
  assert.equal(bestImage({ mint: "So11111111111111111111111111111111111111112", source: "other", image: other }), other);
});

test("a coin that isn't Pump.fun's and has no picture stays without one (nothing is invented)", () => {
  assert.equal(bestImage({ mint: "So11111111111111111111111111111111111111112", source: "other" }), undefined);
});

test("withBestImage returns the same object when nothing changes", () => {
  const c = { mint: PUMP, source: "pump-fun", image: "https://cdn.dexscreener.com/x.png" };
  assert.equal(withBestImage(c), c);
});
