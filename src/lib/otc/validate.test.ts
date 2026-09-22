import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { isPlausibleSignature, isValidPublicKey, validateOtcLaunchFields, OTC_NAME_MAX, OTC_SYMBOL_MAX } from "./validate";
import { OTC_REWARD_ASSETS } from "./reward-assets";

const mint = Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
const quoteMint = OTC_REWARD_ASSETS[0].mint;
const base = { mint, creator, name: "My Coin", symbol: "MINE", uri: "https://example.com/m.json", quoteMint };

test("a fully valid launch passes", () => {
  assert.equal(validateOtcLaunchFields(base), null);
  assert.equal(validateOtcLaunchFields({ ...base, mode: "low", buy: "0" }), null);
  assert.equal(validateOtcLaunchFields({ ...base, mode: "high", buy: "12.5" }), null);
});

test("bad public keys are rejected", () => {
  assert.match(validateOtcLaunchFields({ ...base, mint: "nope" }) ?? "", /mint/);
  assert.match(validateOtcLaunchFields({ ...base, creator: "nope" }) ?? "", /creator/);
  assert.match(validateOtcLaunchFields({ ...base, quoteMint: "nope" }) ?? "", /quoteMint/);
});

test("a quoteMint not offered by OTC is rejected — never forwarded arbitrarily", () => {
  const randomMint = Keypair.generate().publicKey.toBase58();
  assert.match(validateOtcLaunchFields({ ...base, quoteMint: randomMint }) ?? "", /isn't offered/);
});

test("OTC's own documented limits: name ≤ 32, symbol ≤ 13", () => {
  assert.equal(validateOtcLaunchFields({ ...base, name: "x".repeat(OTC_NAME_MAX) }), null);
  assert.match(validateOtcLaunchFields({ ...base, name: "x".repeat(OTC_NAME_MAX + 1) }) ?? "", /name/);
  assert.equal(validateOtcLaunchFields({ ...base, symbol: "x".repeat(OTC_SYMBOL_MAX) }), null);
  assert.match(validateOtcLaunchFields({ ...base, symbol: "x".repeat(OTC_SYMBOL_MAX + 1) }) ?? "", /symbol/);
});

test("mode and buy are constrained", () => {
  assert.match(validateOtcLaunchFields({ ...base, mode: "medium" }) ?? "", /mode/);
  assert.match(validateOtcLaunchFields({ ...base, buy: "abc" }) ?? "", /buy/);
  assert.match(validateOtcLaunchFields({ ...base, buy: "-1" }) ?? "", /buy/);
});

test("isValidPublicKey / isPlausibleSignature", () => {
  assert.equal(isValidPublicKey(mint), true);
  assert.equal(isValidPublicKey(""), false);
  assert.equal(isValidPublicKey(123), false);
  assert.equal(isPlausibleSignature("1".repeat(87)), true);
  assert.equal(isPlausibleSignature("too-short"), false);
  assert.equal(isPlausibleSignature(undefined), false);
});
