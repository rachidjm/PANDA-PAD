import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawAmount } from "./holders";

// This exact function once shipped with its regex missing a backslash (/^d+$/), which silently
// rejected every real balance and made the rewards cron credit nobody. Real balances must parse.
test("real on-chain balances parse exactly, including ones above 2^53", () => {
  assert.equal(parseRawAmount("0"), BigInt(0));
  assert.equal(parseRawAmount("1"), BigInt(1));
  assert.equal(parseRawAmount("123456789"), BigInt(123456789));
  assert.equal(parseRawAmount("1000000000000000000000"), BigInt("1000000000000000000000"));
  assert.equal(parseRawAmount("9007199254740993"), BigInt("9007199254740993"));
});

test("anything that isn't a plain non-negative integer string is refused", () => {
  for (const bad of ["", "-1", "1.5", "1e9", " 1", "1 ", "abc", "d", "dd", "0x10", "١٢٣", 5, null, undefined, {}, []]) {
    assert.equal(parseRawAmount(bad), null, String(bad));
  }
});
