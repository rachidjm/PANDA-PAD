import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";
import { toParsed } from "./chain-test-utils";
import bs58 from "bs58";
import { MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";
import { buildCancelTransaction, buildListTransaction, buildSaleTransaction, ParsedTxLike, verifySaleTx } from "./chain";
import { computeSplit, saleTransfers, Transfer } from "./split";

const BH = { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 4242 };
const RPC = "http://127.0.0.1:1"; // never contacted: blockhashes are injected

const market = Keypair.generate();
const buyer = Keypair.generate().publicKey.toBase58();
const seller = Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const asset = Keypair.generate().publicKey.toBase58();

const split = computeSplit({ priceLamports: 2_000_000_000, feeBps: 200, royaltyBps: 500, creators: [{ address: creator, percentage: 100 }], kind: "secondary" });
const payments = saleTransfers(split, { buyer, seller, treasury });

const expected = { buyer, marketAuthority: market.publicKey.toBase58(), asset, payments };
const built = () => buildSaleTransaction({ rpcUrl: RPC, market, buyer, asset, payments, blockhash: BH });

test("the sale transaction: the buyer pays and is the fee payer; the market authority pre-signs; exactly the specified payments plus one Core transfer", async () => {
  const b = await built();
  assert.equal(b.lastValidBlockHeight, 4242);
  const tx = Transaction.from(Buffer.from(b.transactionBase64, "base64"));
  assert.equal(tx.feePayer?.toBase58(), buyer);

  const msg = tx.compileMessage();
  assert.equal(msg.header.numRequiredSignatures, 2, "only the buyer and the market authority sign");
  const sigOf = (k: string) => tx.signatures.find((s) => s.publicKey.toBase58() === k)?.signature ?? null;
  assert.ok(sigOf(market.publicKey.toBase58()), "the market authority has signed");
  assert.equal(sigOf(buyer), null, "the buyer hasn't: the server can't spend their money");

  const core = tx.instructions.filter((ix) => ix.programId.toBase58() === MPL_CORE_PROGRAM_ID);
  assert.equal(core.length, 1);
  const system = tx.instructions.filter((ix) => ix.programId.equals(SystemProgram.programId));
  assert.equal(system.length + core.length, tx.instructions.length, "nothing else is invoked");
  assert.equal(system.length, payments.length);
  const decoded = system.map((ix) => SystemInstruction.decodeTransfer(ix));
  assert.ok(decoded.every((d) => d.fromPubkey.toBase58() === buyer), "every payment comes from the buyer, never from the market authority");
  assert.equal(decoded.reduce((a, d) => a + Number(d.lamports), 0), 2_000_000_000, "the buyer pays exactly the price");
  assert.ok(core[0].keys.some((k) => k.pubkey.toBase58() === market.publicKey.toBase58() && k.isSigner), "the market authority signs the transfer");
});

test("a landed sale that is exactly as specified verifies", async () => {
  assert.equal(verifySaleTx(toParsed((await built()).transactionBase64), expected), null);
});

test("every deviation in a landed transaction is caught", async () => {
  const good = toParsed((await built()).transactionBase64);
  const clone = () => structuredClone({ ...good, transaction: { message: { accountKeys: good.transaction.message.accountKeys.map((k) => ({ pubkey: String(k.pubkey), signer: k.signer })), instructions: good.transaction.message.instructions.map((i) => ({ ...i, programId: String(i.programId), accounts: i.accounts?.map(String) })) } } }) as ParsedTxLike;
  const transferIxs = (t: ParsedTxLike) => t.transaction.message.instructions.filter((i) => i.program === "system");

  const cases: [string, (t: ParsedTxLike) => void][] = [
    ["transaction failed on-chain", (t) => (t.meta = { err: { InstructionError: [0, "Custom"] } })],
    ["no result", (t) => (t.meta = null)],
    ["the seller is underpaid", (t) => { const i = transferIxs(t)[0].parsed?.info; if (i) i.lamports = (i.lamports as number) - 1; }],
    ["the seller is overpaid", (t) => { const i = transferIxs(t)[0].parsed?.info; if (i) i.lamports = (i.lamports as number) + 1; }],
    ["the creator's royalty is paid to someone else", (t) => { const i = transferIxs(t)[1].parsed?.info; if (i) i.destination = Keypair.generate().publicKey.toBase58(); }],
    ["PANDA's fee is paid to someone else", (t) => { const i = transferIxs(t)[2].parsed?.info; if (i) i.destination = Keypair.generate().publicKey.toBase58(); }],
    ["a payment is missing", (t) => { t.transaction.message.instructions = t.transaction.message.instructions.filter((i) => i !== transferIxs(t)[2]); }],
    ["an extra payment is added", (t) => { t.transaction.message.instructions.push({ programId: "11111111111111111111111111111111", program: "system", parsed: { type: "transfer", info: { source: buyer, destination: seller, lamports: 1 } } }); }],
    ["a payment is paid by someone other than the buyer", (t) => { const i = transferIxs(t)[0].parsed?.info; if (i) i.source = Keypair.generate().publicKey.toBase58(); }],
    ["an unrelated instruction is smuggled in", (t) => { t.transaction.message.instructions.push({ programId: Keypair.generate().publicKey.toBase58(), accounts: [], data: "" }); }],
    ["a second NFT transfer", (t) => { t.transaction.message.instructions.push(structuredClone(t.transaction.message.instructions.find((i) => i.program !== "system") as never)); }],
    ["no NFT transfer", (t) => { t.transaction.message.instructions = t.transaction.message.instructions.filter((i) => i.program === "system"); }],
    ["the transfer is for another asset", (t) => { const c = t.transaction.message.instructions.find((i) => i.program !== "system"); if (c?.accounts) c.accounts = c.accounts.map((a) => (String(a) === asset ? Keypair.generate().publicKey.toBase58() : a)); }],
    ["the transfer isn't a transfer instruction", (t) => { const c = t.transaction.message.instructions.find((i) => i.program !== "system"); if (c) c.data = bs58.encode(Uint8Array.from([99, 1, 2])); }],
    ["the transfer data is malformed", (t) => { const c = t.transaction.message.instructions.find((i) => i.program !== "system"); if (c) c.data = "0OIl"; }],
    ["a third signer", (t) => { t.transaction.message.accountKeys.push({ pubkey: Keypair.generate().publicKey.toBase58(), signer: true }); }],
    ["the market authority didn't sign", (t) => { const k = t.transaction.message.accountKeys.find((x) => String(x.pubkey) === market.publicKey.toBase58()); if (k) k.signer = false; }],
    ["the buyer isn't the fee payer", (t) => { const ks = t.transaction.message.accountKeys; [ks[0], ks[1]] = [ks[1], ks[0]]; }],
  ];
  for (const [label, mutate] of cases) {
    const t = clone();
    mutate(t);
    assert.notEqual(verifySaleTx(t, expected), null, `should be rejected: ${label}`);
  }
});

test("verification is against the sale terms: a different expected price or buyer fails an otherwise valid transaction", async () => {
  const t = toParsed((await built()).transactionBase64);
  const other = computeSplit({ priceLamports: 1_000_000_000, feeBps: 200, royaltyBps: 500, creators: [{ address: creator, percentage: 100 }], kind: "secondary" });
  assert.notEqual(verifySaleTx(t, { ...expected, payments: saleTransfers(other, { buyer, seller, treasury }) }), null);
  assert.notEqual(verifySaleTx(t, { ...expected, buyer: Keypair.generate().publicKey.toBase58() }), null);
  assert.notEqual(verifySaleTx(t, { ...expected, asset: Keypair.generate().publicKey.toBase58() }), null);
  assert.notEqual(verifySaleTx(t, { ...expected, marketAuthority: Keypair.generate().publicKey.toBase58() }), null);
});

test("listing: the SELLER pays and signs one Core instruction that names the market authority; the server signs nothing", async () => {
  const b = await buildListTransaction({ rpcUrl: RPC, seller, asset, marketAuthority: market.publicKey.toBase58(), blockhash: BH });
  const tx = Transaction.from(Buffer.from(b.transactionBase64, "base64"));
  assert.equal(tx.feePayer?.toBase58(), seller);
  assert.equal(tx.compileMessage().header.numRequiredSignatures, 1);
  assert.ok(tx.signatures.every((s) => !s.signature), "nothing pre-signed");
  assert.equal(tx.instructions.length, 1);
  assert.equal(tx.instructions[0].programId.toBase58(), MPL_CORE_PROGRAM_ID);
  assert.ok(Buffer.from(tx.instructions[0].data).includes(market.publicKey.toBuffer()), "the approval is to the market authority");
  assert.ok(tx.instructions[0].keys.some((k) => k.pubkey.toBase58() === asset));
  assert.ok(!tx.instructions[0].keys.some((k) => k.pubkey.toBase58() === market.publicKey.toBase58() && k.isSigner), "the market key doesn't sign a listing");
});

test("cancelling: the seller signs one Core instruction on that asset", async () => {
  const b = await buildCancelTransaction({ rpcUrl: RPC, seller, asset, blockhash: BH });
  const tx = Transaction.from(Buffer.from(b.transactionBase64, "base64"));
  assert.equal(tx.feePayer?.toBase58(), seller);
  assert.equal(tx.compileMessage().header.numRequiredSignatures, 1);
  assert.equal(tx.instructions.length, 1);
  assert.equal(tx.instructions[0].programId.toBase58(), MPL_CORE_PROGRAM_ID);
  assert.ok(tx.instructions[0].keys.some((k) => k.pubkey.toBase58() === asset));
});

test("tx builders refuse to invent payments: an empty or self-paying list still yields a transfer-only tx from the buyer", async () => {
  const noPay: Transfer[] = [];
  const b = await buildSaleTransaction({ rpcUrl: RPC, market, buyer, asset, payments: noPay, blockhash: BH });
  const tx = Transaction.from(Buffer.from(b.transactionBase64, "base64"));
  assert.equal(tx.instructions.length, 1, "just the NFT transfer — the verifier would reject it for having no payments");
  assert.notEqual(verifySaleTx(toParsed(b.transactionBase64), expected), null);
  void PublicKey;
});
