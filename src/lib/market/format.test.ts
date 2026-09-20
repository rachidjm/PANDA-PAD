import { test } from "node:test";
import assert from "node:assert/strict";
import { lamportsToSol, solToLamports } from "./format";

test("what a seller types becomes exact lamports", () => {
  assert.equal(solToLamports("1"), 1_000_000_000);
  assert.equal(solToLamports("1.25"), 1_250_000_000);
  assert.equal(solToLamports("0.001"), 1_000_000);
  assert.equal(solToLamports("0.000000001"), 1);
  assert.equal(solToLamports(" 2.5 "), 2_500_000_000);
  assert.equal(solToLamports("0.1"), 100_000_000, "the classic float trap: 0.1 * 1e9");
  assert.equal(solToLamports("1000"), 1_000_000_000_000);
});

test("anything that isn't a plain amount is refused", () => {
  for (const bad of ["", "-1", "1e3", "1,5", "1.0000000001", "abc", ".5", "5.", "1 000", "0x10", "NaN", "Infinity", "99999999"]) {
    assert.equal(solToLamports(bad), null, bad);
  }
});

test("round trip is exact for a wide range of amounts", () => {
  let s = 12345;
  for (let i = 0; i < 3000; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const lamports = 1 + (s % 1_000_000) * 1000 + (s % 997);
    assert.equal(solToLamports(lamportsToSol(lamports)), lamports);
  }
  assert.equal(lamportsToSol(1_000_000_000), "1");
  assert.equal(lamportsToSol(1_500_000_000), "1.5");
  assert.equal(lamportsToSol(1), "0.000000001");
});
