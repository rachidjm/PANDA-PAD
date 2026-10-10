import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgListOrders, pgNonceAccounts, pgSetNonceState, pgTransition } from "@/lib/db/panda-orders";
import { accountsView, closeNonces, confirmClosed, listOrders, prepareOrders, submitOrders, type PrepareResult } from "./service";
import { closeError, closeFailureCode } from "./close-errors";
import { fakeVenue, newChain, nonceInfo, randomNonceValue, serviceDeps, TEST_ENV } from "./testing";

/**
 * "Recuperar depósitos", "Cancelar todo" and the × of a line. The button once offered a deposit the server then refused
 * to return ("nothing") and the panel said nothing at all: the list and the close followed two different rules about an
 * order that was drawn but never signed. Now both read the same view, and every refusal has a code.
 */

const RENT = 1_056_640;
const MINT = Keypair.generate().publicKey.toBase58();
let db: Db;
let n = 0;
const group = () => `rgroup-${String(++n).padStart(4, "0")}`;

before(async () => {
  Object.assign(process.env, TEST_ENV);
  db = await newTestDb();
});

function setup() {
  const chain = newChain(fakeVenue("curve", 1));
  const kp = Keypair.generate();
  chain.balances.set(kp.publicKey.toBase58(), BigInt(1_000_000));
  return { chain, kp, deps: serviceDeps(db, chain), wallet: kp.publicKey.toBase58() };
}
const input = (wallet: string, groupId: string, tranches: unknown[]) => ({ wallet, mint: MINT, ticker: "TST", groupId, n: 1, tranches, riskAccepted: true });
const sign = (base64: string, kp: Keypair) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  tx.sign([kp]);
  return Buffer.from(tx.serialize()).toString("base64");
};
type Ctx = ReturnType<typeof setup>;

/** The wallet pays the deposit (the accounts appear on chain); the orders are prepared but NOT signed yet. */
async function prepared(c: Ctx, gid: string, tranches: unknown[]) {
  const first = await prepareOrders(c.deps, input(c.wallet, gid, tranches));
  if (first.ok && first.phase === "setup") for (const a of first.nonceAccounts) c.chain.accounts.set(a, nonceInfo(c.kp.publicKey, randomNonceValue()));
  const r = await prepareOrders(c.deps, input(c.wallet, gid, tranches));
  assert.equal(r.ok && r.phase === "orders", true, JSON.stringify(r));
  return r as Extract<PrepareResult, { phase: "orders" }>;
}
/** …and signed: live orders. */
async function live(c: Ctx, gid: string, tranches: unknown[]) {
  const r = await prepared(c, gid, tranches);
  const s = await submitOrders(c.deps, { wallet: c.wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, c.kp) })) });
  assert.equal(s.ok, true, JSON.stringify(s));
}
const rowsOf = async (c: Ctx, gid: string) => (await pgListOrders(db, c.wallet)).filter((o) => o.groupId === gid);
/** What the button offers and what pressing it returns must always be the same accounts. */
async function offeredAndReturned(c: Ctx) {
  const offered = (await listOrders(c.deps, { wallet: c.wallet })).freeNonces;
  const r = await closeNonces(c.deps, { wallet: c.wallet, recover: true });
  return { offered, r, returned: r.ok ? [...r.nonceAccounts].sort() : [] };
}

test("THE BUG: an order that was drawn but never signed no longer blocks 'Recuperar depósitos' — every deposit comes back", async () => {
  const c = setup();
  const gid = group();
  await prepared(c, gid, [{ trancheId: "t-aaaa1", pct: 10, sellUsd: 2 }]); // deposit paid (order account + reserve), then the wallet was closed
  const { offered, r, returned } = await offeredAndReturned(c);
  assert.equal(offered.length, 2, "both accounts are offered: the order account and the reserve");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(returned, offered);
  if (r.ok) assert.equal(r.lamports, 2 * RENT);
  assert.equal((await rowsOf(c, gid)).length, 0, "the unsigned drawing is gone: it could never be signed on a closed account");
});

test("no live orders: ALL deposits come back, the reserve included (the order was cancelled by the watcher, its accounts were left behind)", async () => {
  const c = setup();
  const gid = group();
  await live(c, gid, [{ trancheId: "t-bbbb1", pct: 10, sellUsd: 2 }]);
  for (const o of await rowsOf(c, gid)) await pgTransition(db, o.id, ["active"], { state: "cancelled", reason: "invalid" }, c.deps.clock.t);
  const { offered, returned } = await offeredAndReturned(c);
  assert.equal(offered.length, 2);
  assert.deepEqual(returned, offered);
  // The chain closes them; the server then marks what is really gone.
  for (const a of returned) c.chain.accounts.delete(a);
  await confirmClosed(c.deps, { wallet: c.wallet, nonceAccounts: returned });
  const after = await listOrders(c.deps, { wallet: c.wallet });
  assert.deepEqual(after.freeNonces, []);
  assert.ok((await pgNonceAccounts(db, c.wallet)).every((a) => a.state === "closed"));
});

test("live orders: the free accounts come back EXCEPT the reserve — and a second unsigned drawing changes nothing", async () => {
  const c = setup();
  const gid = group();
  await live(c, gid, [{ trancheId: "t-cccc1", pct: 10, sellUsd: 2 }, { trancheId: "t-cccc2", pct: 10, sellUsd: 3 }]); // 2 order accounts + reserve
  let x = await offeredAndReturned(c);
  assert.deepEqual(x.offered, [], "only the reserve is free: nothing is offered");
  assert.equal(!x.r.ok && x.r.code, "no_deposit", "and asking anyway says so, by name");

  const sold = (await rowsOf(c, gid)).find((o) => o.trancheId === "t-cccc1")!;
  await pgTransition(db, sold.id, ["active"], { state: "executed", executedAt: c.deps.clock.t }, c.deps.clock.t);
  const stillLive = (await rowsOf(c, gid)).find((o) => o.trancheId === "t-cccc2")!.nonceAccount;
  x = await offeredAndReturned(c);
  assert.equal(x.offered.length, 1, "two free now: one comes back, one stays as the reserve");
  assert.deepEqual(x.returned, x.offered);
  assert.ok(!x.returned.includes(stillLive), "the live order's account is never touched");
});

test("accounts from before the reserve existed: a live order with no spare account offers nothing; once it ends, its account comes back", async () => {
  const c = setup();
  const gid = group();
  await live(c, gid, [{ trancheId: "t-dddd1", pct: 10, sellUsd: 2 }]);
  const order = (await rowsOf(c, gid))[0];
  // An old wallet: only the order's own account exists.
  for (const a of await pgNonceAccounts(db, c.wallet)) {
    if (a.address === order.nonceAccount) continue;
    c.chain.accounts.delete(a.address);
    await pgSetNonceState(db, c.wallet, a.address, "closed", c.deps.clock.t);
  }
  let x = await offeredAndReturned(c);
  assert.deepEqual(x.offered, []);
  assert.equal(!x.r.ok && x.r.code, "no_deposit");
  await pgTransition(db, order.id, ["active"], { state: "executed", executedAt: c.deps.clock.t }, c.deps.clock.t);
  x = await offeredAndReturned(c);
  assert.deepEqual(x.offered, [order.nonceAccount]);
  assert.deepEqual(x.returned, [order.nonceAccount]);
});

test("'Cancelar todo' and the × of the last order also return the reserve — even with an unsigned drawing of another strategy around", async () => {
  for (const how of ["all", "line"] as const) {
    const c = setup();
    const gid = group();
    await live(c, gid, [{ trancheId: "t-eeee1", pct: 10, sellUsd: 2 }]);
    await prepared(c, group(), [{ trancheId: "t-eeee9", pct: 10, sellUsd: 4 }]); // drawn afterwards, never signed
    const r = await closeNonces(c.deps, how === "all" ? { wallet: c.wallet, allOf: MINT } : { wallet: c.wallet, groupId: gid, trancheId: "t-eeee1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const total = (await pgNonceAccounts(db, c.wallet)).filter((a) => a.state !== "closed").length;
    if (r.ok) assert.equal(r.nonceAccounts.length, total, `${how}: the order's account and every free one, in one approval`);
  }
});

test("every refusal has its own code — nothing is ever answered with silence", async () => {
  // Already closed on chain: said so, and the stale rows are cleaned so the button disappears.
  let c = setup();
  await prepared(c, group(), [{ trancheId: "t-ffff1", pct: 10, sellUsd: 2 }]);
  c.chain.accounts.clear();
  let r = await closeNonces(c.deps, { wallet: c.wallet, recover: true });
  assert.equal(!r.ok && r.code, "already_closed");
  assert.deepEqual((await listOrders(c.deps, { wallet: c.wallet })).freeNonces, []);

  // They exist but aren't this wallet's nonce accounts: nothing is sent, nothing is marked.
  c = setup();
  await prepared(c, group(), [{ trancheId: "t-ffff2", pct: 10, sellUsd: 2 }]);
  for (const a of [...c.chain.accounts.keys()]) c.chain.accounts.set(a, nonceInfo(Keypair.generate().publicKey, randomNonceValue()));
  r = await closeNonces(c.deps, { wallet: c.wallet, recover: true });
  assert.equal(!r.ok && r.code, "unreadable");
  assert.equal((await listOrders(c.deps, { wallet: c.wallet })).freeNonces.length, 2, "still offered: they are still there");

  // Not even the network fee.
  c = setup();
  await prepared(c, group(), [{ trancheId: "t-ffff3", pct: 10, sellUsd: 2 }]);
  c.chain.sol.set(c.wallet, 100);
  r = await closeNonces(c.deps, { wallet: c.wallet, recover: true });
  assert.equal(!r.ok && r.code, "insufficient_sol");
  assert.deepEqual(!r.ok && r.detail, { needLamports: 5000, haveLamports: 100 });

  // The simulation fails, or can't be run: the wallet is never opened.
  c = setup();
  await prepared(c, group(), [{ trancheId: "t-ffff4", pct: 10, sellUsd: 2 }]);
  const ok = c.chain.sim;
  c.chain.sim = () => ({ err: { InstructionError: [0, "Custom"] }, logs: [] });
  r = await closeNonces(c.deps, { wallet: c.wallet, recover: true });
  assert.equal(!r.ok && r.code, "simulation_failed");
  c.chain.sim = () => {
    throw new Error("rpc down");
  };
  r = await closeNonces(c.deps, { wallet: c.wallet, recover: true });
  assert.equal(!r.ok && r.code, "simulation_unavailable");
  c.chain.sim = ok;
  assert.equal((await closeNonces(c.deps, { wallet: c.wallet, recover: true })).ok, true, "and it works again afterwards");

  // A wallet with nothing at all.
  c = setup();
  r = await closeNonces(c.deps, { wallet: c.wallet, recover: true });
  assert.equal(!r.ok && r.code, "no_deposit");
  r = await closeNonces(c.deps, { wallet: c.wallet, allOf: MINT });
  assert.equal(!r.ok && r.code, "nothing");
});

test("the view both the list and the close read: unsigned drawings hold nothing; the reserve stays only while a signed order is live", () => {
  const rows = [{ address: "b", state: "ready" }, { address: "a", state: "ready" }, { address: "c", state: "pending" }, { address: "z", state: "closed" }];
  assert.deepEqual(accountsView([], rows).recoverable, ["a", "b", "c"]);
  assert.deepEqual(accountsView([{ nonceAccount: "a", state: "prepared" }], rows).recoverable, ["a", "b", "c"]);
  const v = accountsView([{ nonceAccount: "a", state: "active" }, { nonceAccount: "b", state: "prepared" }], rows);
  assert.deepEqual(v.free, ["b", "c"]);
  assert.deepEqual(v.recoverable, ["c"], "one of the two free ones is the reserve");
  assert.equal(v.live.length, 1);
});

test("the panel always has something to say: server codes, no-code answers, wallet, network", () => {
  assert.equal(closeFailureCode(404, "no_deposit"), "no_deposit");
  assert.equal(closeFailureCode(401, undefined), "AUTH_REQUIRED");
  assert.equal(closeFailureCode(429, undefined), "too_many_requests");
  assert.equal(closeFailureCode(500, undefined), "server_error");
  assert.equal(closeFailureCode(502, ""), "server_error");

  const api = Object.assign(new Error("Not enough SOL"), { api: true, code: "insufficient_sol", detail: { needLamports: 5000, haveLamports: 1 } });
  assert.deepEqual(closeError(api), { message: "Not enough SOL", code: "insufficient_sol", detail: { needLamports: 5000, haveLamports: 1 } });
  assert.equal(closeError(Object.assign(new Error(""), { api: true })).code, "server_error");
  assert.equal(closeError(new Error("User rejected the request.")).code, "REJECTED");
  assert.equal(closeError(new Error("The transaction failed on-chain.")).code, "close_failed");
  assert.equal(closeError(new Error("The transaction wasn't confirmed in time — check your wallet before trying again.")).code, "close_unconfirmed");
  assert.equal(closeError(new TypeError("Failed to fetch")).code, "server_error");
  assert.equal(closeError(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" })).code, "server_error");
  assert.equal(closeError(new Error("Unexpected error")).code, "wallet_error");
  assert.equal(closeError("boom").code, "wallet_error");
  for (const e of [api, new Error("x"), "boom", null, undefined, {}]) assert.ok(closeError(e).code, "never without a code");
});
