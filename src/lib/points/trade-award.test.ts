import { test } from "node:test";
import assert from "node:assert/strict";
import { countedVolumeLamports, findPandaFee } from "./trade-award";

const TREASURY = "TreasuryAddr1111111111111111111111111111111";
const W = "WalletAddr11111111111111111111111111111111";

const ix = (source: string, destination: string, lamports: unknown, program = "system", type = "transfer") =>
  ({ program, parsed: { type, info: { source, destination, lamports } } }) as never;
const tx = (...instructions: unknown[]) => ({ transaction: { message: { instructions } } }) as never;

test("finds the fee the trader paid to the treasury, and where it sits", () => {
  const t = tx({ programId: "x" }, ix(W, "SomeoneElse", 5), ix(W, TREASURY, 10_000_000));
  assert.deepEqual(findPandaFee(t, W, TREASURY), { lamports: 10_000_000, instructionIndex: 2 });
});

test("several fee transfers add up; the first index names the event", () => {
  const t = tx(ix(W, TREASURY, 100), ix(W, TREASURY, 50));
  assert.deepEqual(findPandaFee(t, W, TREASURY), { lamports: 150, instructionIndex: 0 });
});

test("not a PANDA trade: no transfer, wrong payer, wrong destination, wrong program/type, bad amounts", () => {
  assert.equal(findPandaFee(tx(), W, TREASURY), null);
  assert.equal(findPandaFee(tx(ix("OtherPayer", TREASURY, 100)), W, TREASURY), null);
  assert.equal(findPandaFee(tx(ix(W, "NotTreasury", 100)), W, TREASURY), null);
  assert.equal(findPandaFee(tx(ix(W, TREASURY, 100, "spl-token")), W, TREASURY), null);
  assert.equal(findPandaFee(tx(ix(W, TREASURY, 100, "system", "createAccount")), W, TREASURY), null);
  for (const bad of [0, -5, 1.5, NaN, "100", undefined]) assert.equal(findPandaFee(tx(ix(W, TREASURY, bad)), W, TREASURY), null, String(bad));
});

test("counted volume is the LOWER of fee-implied and observed volume", () => {
  // 1% fee: 10_000_000 lamports of fee implies 1 SOL of volume.
  assert.equal(countedVolumeLamports(10_000_000, 2_000_000_000, 100), 1_000_000_000);
  // A fee that claims more volume than actually moved is capped at what moved.
  assert.equal(countedVolumeLamports(500_000_000, 1_000_000_000, 100), 1_000_000_000);
  for (const bad of [0, -1, NaN, 1.5]) {
    assert.equal(countedVolumeLamports(bad, 1_000_000_000, 100), 0);
    assert.equal(countedVolumeLamports(10_000_000, bad, 100), 0);
  }
});
