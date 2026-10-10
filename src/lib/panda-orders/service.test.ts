import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgListOrders, pgNonceAccounts, pgTransition } from "@/lib/db/panda-orders";
import { closeNonces, confirmClosed, listOrders, prepareOrders, submitOrders, type PrepareResult } from "./service";
import { openTx } from "./crypto";
import { fakeVenue, newChain, nonceInfo, randomNonceValue, serviceDeps, TEST_ENV, type Chain } from "./testing";
import { minOutFor, SELL_MARGIN_BPS } from "./math";

/**
 * The PANDA orders service end to end on a real Postgres (PGlite) with a fake chain: what a user gets to sign at each
 * step, what is stored, and every refusal. Signatures are real ed25519 (a Keypair plays the wallet).
 */

let db: Db;
before(async () => {
  db = await newTestDb();
});

const MINT = Keypair.generate().publicKey.toBase58();
let groupCounter = 0;
const group = () => `group-${String(++groupCounter).padStart(4, "0")}`;

function setup(balance = BigInt(1_000_000)) {
  const chain = newChain(fakeVenue("curve", 1));
  const kp = Keypair.generate();
  chain.balances.set(kp.publicKey.toBase58(), balance);
  const deps = serviceDeps(db, chain);
  return { chain, kp, deps, wallet: kp.publicKey.toBase58() };
}

/** First prepare → the setup transaction; the chain then "creates" those nonce accounts for this wallet. */
async function createNonces(deps: ReturnType<typeof serviceDeps>, chain: Chain, kp: Keypair, input: Parameters<typeof prepareOrders>[1]) {
  const r = await prepareOrders(deps, input);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok || r.phase !== "setup") throw new Error("expected the setup phase");
  for (const a of r.nonceAccounts) chain.accounts.set(a, nonceInfo(kp.publicKey, randomNonceValue()));
  return r;
}

const sign = (base64: string, kp: Keypair) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  tx.sign([kp]);
  return Buffer.from(tx.serialize()).toString("base64");
};

const input = (wallet: string, groupId: string, tranches: unknown[], riskAccepted = true) => ({ wallet, mint: MINT, ticker: "TST", groupId, n: 1, tranches, riskAccepted });

test("first time: one setup transaction creates one nonce account per tranche PLUS one reserve, funded and owned by the wallet", async () => {
  const { chain, kp, deps, wallet } = setup();
  const gid = group();
  const r = await createNonces(deps, chain, kp, input(wallet, gid, [{ trancheId: "t-aaaa1", pct: 25, sellUsd: 2 }, { trancheId: "t-aaaa2", pct: 10, stopUsd: 0.5 }]));
  assert.equal(r.nonceAccounts.length, 3, "two tranches + the reserve");
  assert.equal(r.rentLamports, 1_056_640);
  const rows = await pgNonceAccounts(db, wallet);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((x) => x.state === "pending"));
});

test("then: one transaction per leg, any % with NO $10 minimum, sell+stop of a tranche on the SAME nonce, amounts from the real balance", async () => {
  const { chain, kp, deps, wallet } = setup(BigInt(1_000_000));
  const gid = group();
  const tranches = [{ trancheId: "t-bbbb1", pct: 5, sellUsd: 2, stopUsd: 0.5 }, { trancheId: "t-bbbb2", pct: 10, stopUsd: 0.8 }];
  await createNonces(deps, chain, kp, input(wallet, gid, tranches));
  const r = (await prepareOrders(deps, input(wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  assert.equal(r.phase, "orders");
  assert.equal(r.orders.length, 3);
  const rows = (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid);
  const t1 = rows.filter((o) => o.trancheId === "t-bbbb1");
  assert.equal(t1.length, 2);
  assert.equal(t1[0].nonceAccount, t1[1].nonceAccount, "the two legs of a tranche share one nonce");
  assert.equal(t1[0].tokenAmountRaw, "50000", "5% of 1,000,000 — a few cents' worth is fine, there's no minimum");
  const sell = t1.find((o) => o.leg === "sell")!;
  assert.equal(sell.triggerOutLamports, 100_000, "50,000 tokens pay 50,000 now; drawn at 2× → 100,000");
  assert.equal(sell.minOutLamports, Number(minOutFor(BigInt(100_000), "sell")));
  assert.equal(sell.minOutLamports, 100_000 * (10_000 - SELL_MARGIN_BPS) / 10_000);
  assert.equal(sell.feeLamports, Math.floor(sell.minOutLamports / 100), "1% of the guaranteed minimum");
  assert.notEqual(rows.find((o) => o.trancheId === "t-bbbb2")!.nonceAccount, t1[0].nonceAccount, "another tranche, another nonce");
  for (const o of r.orders) {
    const tx = VersionedTransaction.deserialize(Buffer.from(o.transaction, "base64"));
    assert.equal(tx.message.staticAccountKeys[0].toBase58(), wallet);
    assert.equal(Buffer.from(tx.message.compiledInstructions[0].data).readUInt32LE(0), 4, "AdvanceNonce first");
  }
});

test("submit: every signed order is checked and stored ENCRYPTED; the list never returns signed bytes", async () => {
  const { chain, kp, deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-cccc1", pct: 50, sellUsd: 3, stopUsd: 0.6 }];
  await createNonces(deps, chain, kp, input(wallet, gid, tranches));
  const r = (await prepareOrders(deps, input(wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  const s = await submitOrders(deps, { wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, kp) })) });
  assert.equal(s.ok, true, JSON.stringify(s));
  const rows = (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid);
  assert.ok(rows.every((o) => o.state === "active" && o.txCiphertext && o.signature));
  const bytes = openTx(rows[0].id, { ciphertext: rows[0].txCiphertext!, iv: rows[0].txIv! }, TEST_ENV)!;
  assert.ok(VersionedTransaction.deserialize(bytes).signatures[0].some((b) => b !== 0), "what's stored is the user's signed transaction");
  const listed = await listOrders(deps, { wallet, mint: MINT });
  const json = JSON.stringify(listed);
  assert.ok(!/txCiphertext|txIv|messageHash/.test(json));
  assert.equal(listed.committedRaw, "500000", "the tranche's tokens counted once, not once per leg");
  assert.ok(deps.audits.includes("panda_orders.submit"));
});

test("submit refuses a transaction the wallet modified, a missing leg, or a foreign signature — and stores NOTHING", async () => {
  const { chain, kp, deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-dddd1", pct: 20, sellUsd: 2, stopUsd: 0.5 }];
  await createNonces(deps, chain, kp, input(wallet, gid, tranches));
  const r = (await prepareOrders(deps, input(wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  const [a, b] = r.orders;
  // Only one of the two legs: the batch is all or nothing.
  const partial = await submitOrders(deps, { wallet, groupId: gid, signed: [{ id: a.id, transaction: sign(a.transaction, kp) }] });
  assert.equal(partial.ok, false);
  // The other leg's bytes under this leg's id = a different message than the one prepared for it.
  const swapped = await submitOrders(deps, { wallet, groupId: gid, signed: [{ id: a.id, transaction: sign(b.transaction, kp) }, { id: b.id, transaction: sign(a.transaction, kp) }] });
  assert.equal(swapped.ok, false);
  if (!swapped.ok) assert.equal(swapped.code, "wallet_modified");
  const forge = (base64: string) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    tx.signatures[0] = Keypair.generate().secretKey.slice(0, 64); // 64 bytes that aren't this wallet's signature
    return Buffer.from(tx.serialize()).toString("base64");
  };
  const foreign = await submitOrders(deps, { wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: forge(o.transaction) })) });
  assert.equal(foreign.ok, false);
  const rows = (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid);
  assert.ok(rows.every((o) => o.state === "prepared" && !o.txCiphertext), "nothing activated");
});

test("tokens already in another live order are NOT available again (no selling more than 100% of the balance)", async () => {
  const { chain, kp, deps, wallet } = setup(BigInt(1_000_000));
  const g1 = group();
  const t1 = [{ trancheId: "t-eeee1", pct: 60, sellUsd: 2 }];
  await createNonces(deps, chain, kp, input(wallet, g1, t1));
  const r1 = (await prepareOrders(deps, input(wallet, g1, t1))) as Extract<PrepareResult, { phase: "orders" }>;
  await submitOrders(deps, { wallet, groupId: g1, signed: r1.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, kp) })) });
  // A second strategy: its 100% is of the 400,000 left, not of 1,000,000.
  const g2 = group();
  const t2 = [{ trancheId: "t-eeee2", pct: 100, stopUsd: 0.5 }];
  await createNonces(deps, chain, kp, input(wallet, g2, t2));
  await prepareOrders(deps, input(wallet, g2, t2));
  const row = (await pgListOrders(db, wallet)).find((o) => o.groupId === g2)!;
  assert.equal(row.tokenAmountRaw, "400000");
});

test("refusals: a stop without accepting the risk, prices on the wrong side, over 100%, no coins, an unsupported coin", async () => {
  const { chain, kp, deps, wallet } = setup();
  const noRisk = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-ffff1", pct: 10, stopUsd: 0.5 }], false));
  assert.equal(noRisk.ok, false);
  if (!noRisk.ok) assert.equal(noRisk.code, "risk_not_accepted");
  const sellOnly = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-ffff2", pct: 10, sellUsd: 2 }], false));
  assert.equal(sellOnly.ok, true, "a sell alone needs no stop warning");
  const wrongSide = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-ffff3", pct: 10, sellUsd: 0.9, stopUsd: 1.1 }]));
  assert.equal(wrongSide.ok, false);
  if (!wrongSide.ok) assert.deepEqual(wrongSide.issues?.["t-ffff3"]?.sort(), ["sell_not_above_current", "stop_not_below_current", "tp_not_above_stop"].sort());
  const over = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-ffff4", pct: 70, sellUsd: 2 }, { trancheId: "t-ffff5", pct: 40, stopUsd: 0.5 }]));
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, "over_100");
  chain.balances.set(wallet, BigInt(0));
  const empty = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-ffff6", pct: 10, sellUsd: 2 }]));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "no_balance");
  chain.venue = "unsupported";
  const other = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-ffff7", pct: 10, sellUsd: 2 }]));
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.code, "unsupported_coin");
  void kp;
});

test("without PANDA_ORDERS_KEY nothing is prepared or stored", async () => {
  const { chain, deps, wallet } = setup();
  const off = { ...deps, hasKey: () => false };
  const r = await prepareOrders(off, input(wallet, group(), [{ trancheId: "t-gggg1", pct: 10, sellUsd: 2 }]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "not_configured");
  void chain;
});

test("cancel = close the tranche's nonce account (deposit back): once the chain shows it gone, its orders are cancelled; a leg that had landed is executed", async () => {
  const { chain, kp, deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-hhhh1", pct: 30, sellUsd: 2, stopUsd: 0.5 }, { trancheId: "t-hhhh2", pct: 30, sellUsd: 3 }];
  await createNonces(deps, chain, kp, input(wallet, gid, tranches));
  const r = (await prepareOrders(deps, input(wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  await submitOrders(deps, { wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, kp) })) });
  const rows = (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid);
  const second = rows.find((o) => o.trancheId === "t-hhhh2")!;
  chain.landed.set(second.signature!, true); // that sell had already executed when the user cancelled

  const close = await closeNonces(deps, { wallet, groupId: gid });
  assert.equal(close.ok, true);
  if (!close.ok) return;
  assert.equal(close.nonceAccounts.length, 3, "both tranches' accounts and — nothing being left live — the reserve");
  assert.equal(close.lamports, 3 * 1_056_640, "the whole deposit comes back, the reserve's too");
  for (const a of close.nonceAccounts) chain.accounts.set(a, null); // the user's close transaction landed
  const done = await confirmClosed(deps, { wallet, nonceAccounts: close.nonceAccounts });
  assert.equal(done.ok, true);
  const after = (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid);
  assert.ok(after.filter((o) => o.trancheId === "t-hhhh1").every((o) => o.state === "cancelled" && !o.txCiphertext), "signed bytes wiped");
  assert.equal(after.find((o) => o.trancheId === "t-hhhh2")!.state, "executed");
  assert.ok((await pgNonceAccounts(db, wallet)).every((n) => n.state === "closed"));
});

test("recover: after an order executes its nonce account is free — its deposit comes back in one approval; accounts still in use are never touched", async () => {
  const { chain, kp, deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-iiii1", pct: 30, sellUsd: 2 }, { trancheId: "t-iiii2", pct: 30, stopUsd: 0.5 }];
  await createNonces(deps, chain, kp, input(wallet, gid, tranches));
  const r = (await prepareOrders(deps, input(wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  await submitOrders(deps, { wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, kp) })) });
  const none = await closeNonces(deps, { wallet, recover: true });
  assert.equal(none.ok, false, "both nonces are in use by live orders, and the reserve stays while there are orders");
  assert.deepEqual((await listOrders(deps, { wallet })).freeNonces, [], "nothing to recover yet");
  const rows = (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid);
  const sold = rows.find((o) => o.trancheId === "t-iiii1")!;
  await pgTransition(db, sold.id, ["active"], { state: "executed", executedAt: deps.clock.t }, deps.clock.t); // the watcher saw it land
  const rec = await closeNonces(deps, { wallet, recover: true });
  assert.equal(rec.ok, true);
  const stillLive = rows.find((o) => o.trancheId === "t-iiii2")!.nonceAccount;
  if (rec.ok) assert.ok(rec.nonceAccounts.length === 1 && rec.nonceAccounts[0] !== stillLive, "one free account comes back; one stays as the reserve; the live one is never touched");
  const listed = await listOrders(deps, { wallet });
  assert.equal(listed.freeNonces.length, 1);
  assert.equal(listed.rentLamports, 1_056_640);
});

test("re-preparing the same draft replaces its unsigned orders and reuses its nonces (no new deposit)", async () => {
  const { chain, kp, deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-jjjj1", pct: 30, sellUsd: 2 }];
  await createNonces(deps, chain, kp, input(wallet, gid, tranches));
  await prepareOrders(deps, input(wallet, gid, tranches));
  const again = await prepareOrders(deps, input(wallet, gid, [{ trancheId: "t-jjjj1", pct: 40, sellUsd: 2.5 }]));
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.phase, "orders");
  const rows = (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pct, 40);
});

test("the user closed the setup popup: right after, 'still being created'; a bit later the SAME accounts are offered again (no new ones)", async () => {
  const { deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-kkkk1", pct: 30, sellUsd: 2 }];
  const first = await prepareOrders(deps, input(wallet, gid, tranches));
  assert.equal(first.ok && first.phase, "setup");
  const soon = await prepareOrders(deps, input(wallet, gid, tranches));
  assert.equal(soon.ok, false);
  if (!soon.ok) assert.equal(soon.code, "nonce_pending");
  deps.clock.t += 30_000;
  const again = await prepareOrders(deps, input(wallet, gid, tranches));
  assert.equal(again.ok && again.phase, "setup");
  if (first.ok && first.phase === "setup" && again.ok && again.phase === "setup") assert.deepEqual(again.nonceAccounts, first.nonceAccounts);
  assert.equal((await pgNonceAccounts(db, wallet)).length, 2, "the tranche's account and the reserve — the same two, not four");
});

test("cancelling always takes the wallet's signature: asking to close changes nothing until the chain shows the account gone", async () => {
  const { chain, kp, deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-zzzz1", pct: 20, sellUsd: 2 }];
  await createNonces(deps, chain, kp, input(wallet, gid, tranches));
  const r = (await prepareOrders(deps, input(wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  await submitOrders(deps, { wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, kp) })) });
  const live = () => pgListOrders(db, wallet).then((rows) => rows.filter((o) => o.groupId === gid));

  // With the session alone: a transaction to sign comes back, the order is still live.
  const close = await closeNonces(deps, { wallet, groupId: gid });
  assert.equal(close.ok, true);
  assert.ok((await live()).every((o) => o.state === "active"));
  // "Confirming" without having sent the signed close: the account is still there, nothing ends.
  if (close.ok) await confirmClosed(deps, { wallet, nonceAccounts: close.nonceAccounts });
  assert.ok((await live()).every((o) => o.state === "active"));

  // An account that exists but can't be read as this wallet's nonce is never taken as closed.
  const nonce = (await live())[0].nonceAccount;
  chain.accounts.set(nonce, nonceInfo(Keypair.generate().publicKey, randomNonceValue()));
  const odd = await closeNonces(deps, { wallet, groupId: gid });
  assert.equal(odd.ok, false);
  assert.ok((await live()).every((o) => o.state === "active"), "still live: no signature, no cancel");
});
