import { test } from "node:test";
import assert from "node:assert/strict";
import { dHashFromGrayscale, hammingDistance, mapWithConcurrency } from "./image-hash";

function solid(value: number): number[] {
  return new Array(9 * 8).fill(value);
}

test("dHashFromGrayscale: a flat image (no left-right edges anywhere) hashes to all zero bits", () => {
  assert.equal(dHashFromGrayscale(solid(128)), "0".repeat(64));
});

test("dHashFromGrayscale: a strictly left-to-right brightening gradient sets every bit to 1", () => {
  const pixels: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 9; col++) pixels.push(col * 28); // strictly increasing across each row
  }
  assert.equal(dHashFromGrayscale(pixels), "1".repeat(64));
});

test("dHashFromGrayscale throws on the wrong pixel count (a caller bug, not a bad image)", () => {
  assert.throws(() => dHashFromGrayscale([1, 2, 3]));
});

test("hammingDistance: identical hashes are 0 apart, fully opposite hashes are maximally apart", () => {
  assert.equal(hammingDistance("0000", "0000"), 0);
  assert.equal(hammingDistance("0000", "1111"), 4);
  assert.equal(hammingDistance("0101", "0110"), 2);
});

test("mapWithConcurrency: runs every item exactly once, preserving input order in the output, capped at the given limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const out = await mapWithConcurrency(items, 3, async (i) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return i * 2;
  });
  assert.deepEqual(out, items.map((i) => i * 2));
  assert.ok(maxInFlight <= 3, `expected at most 3 concurrent, saw ${maxInFlight}`);
});
