import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { buildCreateTransaction, buildFeeSharingTransaction, buildLaunchTransaction, MAX_TX_BYTES } from "./create";
import { launchStaticAddresses, localLookupTable } from "./launch-alt";
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

// ── One-transaction launch: v0 + PANDA's lookup table ────────────────────────────────────────────────────────────────
// A realistic worst case: Pump's own limits on name (32) and symbol (10), and a ~110-character Vercel Blob metadata URL.
const REAL = { name: "N".repeat(32), symbol: "S".repeat(10), uri: "https://abcdef1234567890.public.blob.vercel-storage.com/panda/1750000000000-metadata-Ab3dE6gH.json" };
const BLOCKHASH = "11111111111111111111111111111111";
const launch = async (n: number, table: ReturnType<typeof localLookupTable>, meta = REAL) => {
  const mint = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;
  const shareholders = split(n).map((s, i) => (i === 0 ? { ...s, address: user.toBase58() } : s));
  return { user, tx: await buildLaunchTransaction({ mint, user, ...meta, shareholders, lookupTable: table, blockhash: BLOCKHASH }) };
};

test("the launch's fixed accounts are derived, deterministic, and never include a program id, the mint or the creator", async () => {
  const a = (await launchStaticAddresses()).map((k) => k.toBase58());
  const b = (await launchStaticAddresses()).map((k) => k.toBase58());
  assert.deepEqual(a, b);
  assert.ok(a.length >= 10, `only ${a.length} fixed accounts found`);
  for (const program of ["ComputeBudget111111111111111111111111111111", "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]) assert.ok(!a.includes(program), `program id ${program} can't be looked up`);
});

test("ONE transaction: coin + fee split as v0 with PANDA's lookup table fits 1,232 bytes (real-size metadata), signed by the creator and the mint", async () => {
  const table = localLookupTable(await launchStaticAddresses());
  for (const n of [1, 2, 3, 4]) {
    const { tx, user } = await launch(n, table);
    assert.ok(tx, `${n} shareholders should fit`);
    assert.ok(tx.serialize().length <= MAX_TX_BYTES);
    assert.equal(tx.message.header.numRequiredSignatures, 2, "creator + mint");
    assert.equal(tx.message.staticAccountKeys[0].toBase58(), user.toBase58(), "the creator pays");
    assert.equal(tx.version, 0);
  }
});

test("the mint's signature completes the one-transaction launch (it deserializes as v0 and signs with the mint keypair)", async () => {
  const table = localLookupTable(await launchStaticAddresses());
  const mint = Keypair.generate();
  const user = Keypair.generate().publicKey;
  const tx = await buildLaunchTransaction({ mint: mint.publicKey, user, ...REAL, shareholders: split(2).map((s, i) => (i === 0 ? { ...s, address: user.toBase58() } : s)), lookupTable: table, blockhash: BLOCKHASH });
  assert.ok(tx);
  const wire = VersionedTransaction.deserialize(tx.serialize());
  wire.sign([mint]);
  assert.ok(wire.signatures.some((sig) => sig.some((b) => b !== 0)), "the mint signature is filled in");
});

test("the one-transaction launch carries BOTH the create and PANDA's fee split (it can't exist without it)", async () => {
  const table = localLookupTable(await launchStaticAddresses());
  const { tx } = await launch(2, table);
  assert.ok(tx);
  // compute-limit + create_v2 + createFeeSharingConfig + updateFeeShares
  assert.equal(tx.message.compiledInstructions.length, 4);
});

test("REGRESSION: without the table (or with one that lacks the launch's accounts) the launch does NOT fit, and the builder says so instead of returning something the network rejects", async () => {
  const empty = localLookupTable([]);
  for (const n of [1, 2, 5]) assert.equal((await launch(n, empty)).tx, null, `${n} shareholders without a table`);
});

test("the one-transaction launch falls back (null) when it truly doesn't fit — many shareholders with the longest metadata", async () => {
  const table = localLookupTable(await launchStaticAddresses());
  const huge = { name: "N".repeat(64), symbol: "S".repeat(16), uri: "https://example.com/" + "m".repeat(380) };
  assert.equal((await launch(MAX_SHAREHOLDERS, table, huge)).tx, null);
});

test("how many shareholders fit in one transaction with real-size metadata (documents the frontier the fallback covers)", async () => {
  const table = localLookupTable(await launchStaticAddresses());
  let max = 0;
  for (let n = 1; n <= MAX_SHAREHOLDERS; n++) if ((await launch(n, table)).tx) max = n;
  console.log(`[launch-alt] real-size metadata: up to ${max} of ${MAX_SHAREHOLDERS} shareholders fit in one transaction`);
  assert.ok(max >= 3, "the common case (PANDA + creator + a partner or two) must fit");
});
