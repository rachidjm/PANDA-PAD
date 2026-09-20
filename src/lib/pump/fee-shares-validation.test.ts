import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { validateShareholders } from "./fee-shares-validation";
import { PANDA_TREASURY } from "./constants";

const treasury = PANDA_TREASURY.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
const partner = Keypair.generate().publicKey.toBase58();

test("accepts PANDA 5% + creator 95%", () => {
  assert.equal(validateShareholders([{ address: treasury, shareBps: 500 }, { address: creator, shareBps: 9500 }]), null);
});

test("accepts PANDA 5% + several creator-side recipients", () => {
  assert.equal(
    validateShareholders([
      { address: treasury, shareBps: 500 },
      { address: creator, shareBps: 7000 },
      { address: partner, shareBps: 2500 },
    ]),
    null
  );
});

test("rejects a list that leaves PANDA out (bypass attempt)", () => {
  assert.match(validateShareholders([{ address: creator, shareBps: 10_000 }]) ?? "", /locked/);
});

test("rejects reducing PANDA's share", () => {
  assert.match(
    validateShareholders([{ address: treasury, shareBps: 100 }, { address: creator, shareBps: 9900 }]) ?? "",
    /locked/
  );
});

test("rejects raising PANDA's share above the locked amount", () => {
  assert.match(
    validateShareholders([{ address: treasury, shareBps: 1000 }, { address: creator, shareBps: 9000 }]) ?? "",
    /locked/
  );
});

test("rejects PANDA listed twice", () => {
  assert.notEqual(
    validateShareholders([
      { address: treasury, shareBps: 250 },
      { address: treasury, shareBps: 250 },
      { address: creator, shareBps: 9500 },
    ]),
    null
  );
});

test("rejects totals != 10000, negatives, zero, floats, NaN, malformed addresses", () => {
  const ok = { address: treasury, shareBps: 500 };
  assert.notEqual(validateShareholders([ok, { address: creator, shareBps: 9000 }]), null);
  assert.notEqual(validateShareholders([ok, { address: creator, shareBps: 9600 }]), null);
  assert.notEqual(validateShareholders([ok, { address: creator, shareBps: -9500 }]), null);
  assert.notEqual(validateShareholders([ok, { address: creator, shareBps: 0 }]), null);
  assert.notEqual(validateShareholders([ok, { address: creator, shareBps: 9500.5 }]), null);
  assert.notEqual(validateShareholders([ok, { address: creator, shareBps: NaN }]), null);
  assert.notEqual(validateShareholders([ok, { address: "not-an-address", shareBps: 9500 }]), null);
  assert.notEqual(validateShareholders([]), null);
  assert.notEqual(validateShareholders([ok, { address: 5 as unknown as string, shareBps: 9500 }]), null);
});

test("rejects duplicate creator-side recipients", () => {
  assert.notEqual(
    validateShareholders([
      { address: treasury, shareBps: 500 },
      { address: creator, shareBps: 4500 },
      { address: creator, shareBps: 5000 },
    ]),
    null
  );
});

test("rejects burn / system-program recipients (fees would be lost)", () => {
  for (const dead of ["11111111111111111111111111111111", "1nc1nerator11111111111111111111111111111111"]) {
    assert.match(validateShareholders([{ address: treasury, shareBps: 500 }, { address: dead, shareBps: 9500 }]) ?? "", /lost/);
  }
});
