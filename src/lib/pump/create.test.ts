import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { buildCreateTransaction, buildFeeSharingTransaction } from "./create";
import { MAX_SHAREHOLDERS } from "./fee-shares-validation";

/** Solana's packet limit for a serialized transaction. */
const LIMIT = 1232;

const size = (tx: Transaction, payer: PublicKey) => {
  tx.feePayer = payer;
  tx.recentBlockhash = "11111111111111111111111111111111";
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length; // throws "Transaction too large" past the limit
};
const split = (n: number) => Array.from({ length: n }, (_, i) => ({ address: Keypair.generate().publicKey.toBase58(), shareBps: i === 0 ? 10_000 - 100 * (n - 1) : 100 }));

test("the create transaction fits on its own, and so does the fee-split transaction for every allowed number of shareholders", async () => {
  const mint = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;
  const create = await buildCreateTransaction({ mint, user, name: "N".repeat(32), symbol: "S".repeat(10), uri: "https://example.com/" + "m".repeat(150) });
  assert.ok(size(create, user) <= LIMIT, "create");
  for (let n = 1; n <= MAX_SHAREHOLDERS; n++) {
    const fees = await buildFeeSharingTransaction({ mint, user, shareholders: split(n) });
    assert.ok(size(fees, user) <= LIMIT, `fee split with ${n} shareholders`);
  }
});

test("REGRESSION: create + fee split in ONE transaction does not fit (1,238+ bytes vs 1,232) — that is why a launch is two transactions", async () => {
  const mint = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;
  const create = await buildCreateTransaction({ mint, user, name: "Test", symbol: "TST", uri: "https://example.com/m.json" });
  const fees = await buildFeeSharingTransaction({ mint, user, shareholders: split(2) });
  const combined = new Transaction().add(...create.instructions, ...fees.instructions.slice(1)); // even without the second compute-limit instruction
  assert.throws(() => size(combined, user), /too large/i);
});
