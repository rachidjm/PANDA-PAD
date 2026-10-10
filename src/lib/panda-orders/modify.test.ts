import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgListOrders, pgNonceAccounts, pgSetNonceState, pgTransition } from "@/lib/db/panda-orders";
import { closeNonces, listOrders, prepareOrders, requiredLamports, submitOrders, type PrepareResult } from "./service";
import { prepareModify, submitModify, MODIFY_TTL_MS, type ModifyPrepared } from "./modify";
import { openTx } from "./crypto";
import { fakeVenue, landOnChain, newChain, nonceAwareSim, nonceInfo, randomNonceValue, serviceDeps, TEST_ENV } from "./testing";

/**
 * Before anything is signed (enough SOL, every transaction simulated, an order account never created twice), and changing
 * a live order / cancelling one of its lines with one approval that VOIDS the old order on chain — on a real Postgres
 * (PGlite) with a fake chain that treats nonces like Solana does, and real ed25519 signatures.
 */

let db: Db;
before(async () => {
  db = await newTestDb();
});

const MINT = Keypair.generate().publicKey.toBase58();
let counter = 0;
const group = () => `mgroup-${String(++counter).padStart(4, "0")}`;
const sign = (base64: string, kp: Keypair) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  tx.sign([kp]);
  return Buffer.from(tx.serialize()).toString("base64");
};
const input = (wallet: string, groupId: string, tranches: unknown[], extra: Record<string, unknown> = {}) => ({ wallet, mint: MINT, ticker: "TST", groupId, n: 1, tranches, riskAccepted: true, ...extra });

function setup(balance = BigInt(1_000_000)) {
  const chain = newChain(fakeVenue("curve", 1));
  const kp = Keypair.generate();
  chain.balances.set(kp.publicKey.toBase58(), balance);
  const deps = serviceDeps(db, chain);
  return { chain, kp, deps, wallet: kp.publicKey.toBase58() };
}

/** A wallet with one live tranche (sell at 2, stop at 0.5, 20%) and its reserve account; the chain checks nonces for real. */
async function withLiveTranche(trancheId: string, tranche: Record<string, unknown> = { pct: 20, sellUsd: 2, stopUsd: 0.5 }) {
  const s = setup();
  const gid = group();
  const tranches = [{ trancheId, ...tranche }];
  const first = await prepareOrders(s.deps, input(s.wallet, gid, tranches));
  if (!first.ok || first.phase !== "setup") throw new Error("expected setup");
  assert.equal(first.nonceAccounts.length, 2, "the tranche's account + the reserve, in the same deposit");
  for (const a of first.nonceAccounts) s.chain.accounts.set(a, nonceInfo(s.kp.publicKey, randomNonceValue()));
  s.chain.sim = nonceAwareSim(s.chain);
  const r = (await prepareOrders(s.deps, input(s.wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  const done = await submitOrders(s.deps, { wallet: s.wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, s.kp) })) });
  assert.equal(done.ok, true, JSON.stringify(done));
  const nonceAccount = (await pgListOrders(db, s.wallet)).find((o) => o.groupId === gid)!.nonceAccount;
  const reserve = first.nonceAccounts.find((a) => a !== nonceAccount)!;
  const base = { wallet: s.wallet, groupId: gid, trancheId };
  /** Prepare a change (must come back as "orders": the reserve exists). */
  const prepare = async (change: Record<string, unknown>) => {
    const p = await prepareModify(s.deps, { ...base, riskAccepted: true, ...change });
    if (!p.ok || p.phase !== "orders") throw new Error(`prepare: ${JSON.stringify(p)}`);
    return p;
  };
  /** What the browser sends back after ONE approval: the advance and every order, signed. */
  const signedBody = (p: ModifyPrepared, kp = s.kp) => ({ ...base, ticket: p.ticket, advance: sign(p.advance, kp), signed: p.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, kp) })) });
  const submit = async (body: Record<string, unknown>) => {
    const r = await submitModify(s.deps, body as Parameters<typeof submitModify>[1]);
    return r.ok ? "ok" : r.code;
  };
  return { ...s, gid, trancheId, nonceAccount, reserve, base, prepare, signedBody, submit };
}
const liveOf = async (wallet: string, gid: string) => (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid && o.state === "active");
/** The signed transaction PANDA holds for an order (what the watcher would send). */
const storedTx = (o: { id: string; txCiphertext: string | null; txIv: string | null }) => openTx(o.id, { ciphertext: o.txCiphertext!, iv: o.txIv! }, TEST_ENV)!;

// ── before any signature ────────────────────────────────────────────────────────────────────────────────────────────

test("not enough SOL for the deposit + fees: refused BEFORE any transaction is handed out, with how much is missing", async () => {
  const { chain, deps, wallet } = setup();
  chain.sol.set(wallet, 0);
  const r = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-sol01", pct: 10, sellUsd: 2 }]));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "insufficient_sol");
  assert.deepEqual(r.detail, { needLamports: requiredLamports(2, 1, 1_056_640), haveLamports: 0 });
  assert.equal((await pgNonceAccounts(db, wallet)).length, 0, "no order account was even reserved");
  assert.equal(chain.simulated, 0);
});

test("the deposit covers every account to create: 3 tranches need 4 deposits (one each + the reserve)", async () => {
  const { chain, deps, wallet } = setup();
  chain.sol.set(wallet, requiredLamports(4, 3, 1_056_640) - 1);
  const tranches = [1, 2, 3].map((k) => ({ trancheId: `t-sol1${k}`, pct: 10, sellUsd: 2 }));
  const short = await prepareOrders(deps, input(wallet, group(), tranches));
  assert.equal(short.ok === false && short.code, "insufficient_sol");
  chain.sol.set(wallet, requiredLamports(4, 3, 1_056_640));
  const ok = await prepareOrders(deps, input(wallet, group(), tranches));
  assert.ok(ok.ok && ok.phase === "setup" && ok.nonceAccounts.length === 4);
});

test("the setup transaction is simulated first: one that would fail never reaches the wallet", async () => {
  const { chain, deps, wallet } = setup();
  chain.sim = () => ({ err: { InstructionError: [0, { Custom: 1 }] }, logs: ["Transfer: insufficient lamports 0, need 1056640"] });
  const r = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-sim01", pct: 10, sellUsd: 2 }]));
  assert.equal(r.ok === false && r.code, "insufficient_sol");
  chain.sim = () => ({ err: { InstructionError: [3, "ProgramFailedToComplete"] }, logs: [] });
  const other = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-sim02", pct: 10, sellUsd: 2 }]));
  assert.equal(other.ok === false && other.code, "simulation_failed");
  chain.sim = () => {
    throw new Error("rpc down");
  };
  const down = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-sim03", pct: 10, sellUsd: 2 }]));
  assert.equal(down.ok === false && down.code, "simulation_unavailable");
  assert.equal((await pgNonceAccounts(db, wallet)).length, 0);
});

test("an order account is NEVER offered twice: after the deposit confirmed, a slow read answers 'wait', whatever time passed", async () => {
  const { chain, deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-twice1", pct: 10, sellUsd: 2 }];
  const first = await prepareOrders(deps, input(wallet, gid, tranches));
  assert.equal(first.ok && first.phase, "setup");
  // The user took two minutes reading the wallet's popup; the deposit then landed, but this read doesn't see it yet.
  deps.clock.t += 120_000;
  const sig = "5".repeat(88);
  chain.landed.set(sig, true);
  const again = await prepareOrders(deps, input(wallet, gid, tranches, { setupSignature: sig }));
  assert.equal(again.ok === false && again.code, "nonce_pending", "not a second setup transaction");
  // Without the signature (an old browser tab) the simulation still catches it: the account exists → wait, don't sign.
  chain.sim = (_b, o) => (o.replaceBlockhash ? { err: { InstructionError: [0, { Custom: 0 }] }, logs: ["Create Account: account Address already in use"] } : { err: null, logs: [] });
  const blind = await prepareOrders(deps, input(wallet, gid, tranches));
  assert.equal(blind.ok === false && blind.code, "nonce_pending");
});

test("a deposit the user never approved IS offered again, same address (nothing is left half-done)", async () => {
  const { deps, wallet } = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-twice2", pct: 10, sellUsd: 2 }];
  const first = await prepareOrders(deps, input(wallet, gid, tranches));
  deps.clock.t += 60_000;
  const second = await prepareOrders(deps, input(wallet, gid, tranches));
  assert.ok(first.ok && first.phase === "setup" && second.ok && second.phase === "setup");
  if (first.ok && first.phase === "setup" && second.ok && second.phase === "setup") assert.deepEqual(second.nonceAccounts, first.nonceAccounts);
});

test("every order is simulated before it is handed out: a sell 'failing' on its own minimum is the order working; anything else is refused", async () => {
  const s = setup();
  const gid = group();
  const tranches = [{ trancheId: "t-osim1", pct: 10, sellUsd: 2, stopUsd: 0.5 }];
  const first = await prepareOrders(s.deps, input(s.wallet, gid, tranches));
  if (!first.ok || first.phase !== "setup") throw new Error("expected setup");
  for (const a of first.nonceAccounts) s.chain.accounts.set(a, nonceInfo(s.kp.publicKey, randomNonceValue()));
  s.chain.simulated = 0;
  s.chain.sim = () => ({ err: { InstructionError: [3, { Custom: 6003 }] }, logs: ["Program log: AnchorError occurred. Error Code: TooLittleSolReceived."] });
  const ok = await prepareOrders(s.deps, input(s.wallet, gid, tranches));
  assert.equal(ok.ok && ok.phase, "orders");
  assert.equal(s.chain.simulated, 2, "both legs");
  s.chain.sim = () => ({ err: { InstructionError: [3, { Custom: 6023 }] }, logs: ["Program log: AnchorError occurred. Error Code: NotEnoughTokensToSell."] });
  const noTokens = await prepareOrders(s.deps, input(s.wallet, gid, tranches));
  assert.equal(noTokens.ok === false && noTokens.code, "no_balance");
  s.chain.sim = () => ({ err: "InsufficientFundsForFee", logs: [] });
  const noSol = await prepareOrders(s.deps, input(s.wallet, gid, tranches));
  assert.equal(noSol.ok === false && noSol.code, "insufficient_sol");
});

// ── changing a live order: the old one is voided ON CHAIN ───────────────────────────────────────────────────────────

test("moving the SELL: one batch — advance the old nonce, re-sign both lines on the reserve. Afterwards the OLD transactions can't execute, and the pair still works", async () => {
  const s = await withLiveTranche("t-mod01");
  const before = await liveOf(s.wallet, s.gid);
  const oldSell = before.find((o) => o.leg === "sell")!;
  const oldStop = before.find((o) => o.leg === "stop")!;
  const oldBytes = before.map(storedTx);
  const sim = nonceAwareSim(s.chain);
  assert.ok(oldBytes.every((b) => !sim(b).err), "before: both old transactions are valid on chain");

  const p = await s.prepare({ sellUsd: 3, riskAccepted: false });
  assert.deepEqual(p.orders.map((o) => o.leg).sort(), ["sell", "stop"], "the changed line AND the pair that stays are signed again, on the reserve");
  assert.equal((await pgNonceAccounts(db, s.wallet)).length, 2, "no new order account, no new deposit");
  // Until it is signed and confirmed, nothing has changed — in the database or on chain.
  assert.deepEqual((await liveOf(s.wallet, s.gid)).map((o) => o.id).sort(), before.map((o) => o.id).sort());
  assert.equal(s.chain.sent.length, 0);

  assert.equal(await s.submit(s.signedBody(p)), "ok");
  assert.equal(s.chain.sent.length, 1, "PANDA sent exactly one transaction: the nonce advance");
  // ON CHAIN: the old account's nonce moved, so the old signed transactions are dead — whoever holds a copy.
  for (const b of oldBytes) assert.equal(sim(b).err, "BlockhashNotFound", "the old transaction can no longer execute");
  // In the database: the old rows are history with their bytes erased; the new ones live on the reserve account.
  const after = await liveOf(s.wallet, s.gid);
  assert.equal(after.length, 2);
  const newSell = after.find((o) => o.leg === "sell")!;
  const newStop = after.find((o) => o.leg === "stop")!;
  assert.ok(after.every((o) => o.nonceAccount === s.reserve && o.nonceValue === newSell.nonceValue));
  assert.equal(newSell.targetUsd, 3);
  assert.equal(newSell.triggerOutLamports, 600_000, "200,000 tokens pay 200,000 now; at 3× → 600,000");
  assert.equal(newSell.feeLamports, Math.floor(newSell.minOutLamports / 100), "the same fee rule");
  assert.deepEqual([newStop.targetUsd, newStop.triggerOutLamports, newStop.minOutLamports, newStop.feeLamports, newStop.tokenAmountRaw], [oldStop.targetUsd, oldStop.triggerOutLamports, oldStop.minOutLamports, oldStop.feeLamports, oldStop.tokenAmountRaw], "the pair is the same order, re-signed");
  for (const old of [oldSell, oldStop]) {
    const row = (await pgListOrders(db, s.wallet)).find((o) => o.id === old.id)!;
    assert.deepEqual([row.state, row.reason, row.txCiphertext], ["cancelled", "replaced", null]);
  }
  // The pair keeps working on the new account: both new transactions are valid now; when one lands, the other dies.
  const [sellTx, stopTx] = [storedTx(newSell), storedTx(newStop)];
  assert.ok(!sim(sellTx).err && !sim(stopTx).err);
  landOnChain(s.chain, sellTx, true);
  assert.equal(sim(stopTx).err, "BlockhashNotFound", "the sell filled → its stop can never execute");
  // The old account is the reserve now: still the wallet's, free, and not offered for "recover" while orders are live.
  const listed = await listOrders(s.deps, { wallet: s.wallet, mint: MINT });
  assert.equal(listed.orders.filter((o) => o.groupId === s.gid).length, 2, "the replaced rows aren't shown as cancelled orders");
  assert.deepEqual(listed.freeNonces, []);
  assert.equal(listed.committedRaw, "200000");
  assert.ok(s.deps.audits.includes("panda_orders.modify"));
  // And it can be changed again, straight away, using the old account as the reserve — still no deposit.
  s.chain.accounts.set(s.reserve, nonceInfo(s.kp.publicKey, newSell.nonceValue)); // (undo the fill above)
  const p2 = await s.prepare({ sellUsd: 4, riskAccepted: false });
  assert.equal(await s.submit(s.signedBody(p2)), "ok");
  assert.ok((await liveOf(s.wallet, s.gid)).every((o) => o.nonceAccount === s.nonceAccount), "back on the first account");
  assert.equal((await pgNonceAccounts(db, s.wallet)).length, 2);
});

test("if the user doesn't sign, the old order stays exactly as it was", async () => {
  const s = await withLiveTranche("t-mod02");
  const before = await liveOf(s.wallet, s.gid);
  await s.prepare({ sellUsd: 4 });
  const after = await liveOf(s.wallet, s.gid);
  assert.deepEqual(after.map((o) => [o.id, o.targetUsd, o.txCiphertext]), before.map((o) => [o.id, o.targetUsd, o.txCiphertext]));
  assert.ok(before.every((o) => !nonceAwareSim(s.chain)(storedTx(o)).err));
});

test("if the nonce advance does NOT confirm, nothing is cancelled or changed — and the same request finishes the job once it does", async () => {
  const s = await withLiveTranche("t-mod03");
  const before = await liveOf(s.wallet, s.gid);
  const oldBytes = before.map(storedTx);
  const sim = nonceAwareSim(s.chain);
  const body = s.signedBody(await s.prepare({ sellUsd: 3 }));
  s.chain.sendMode = "drop"; // sent, never confirmed
  assert.equal(await s.submit(body), "advance_pending");
  const now = await liveOf(s.wallet, s.gid);
  assert.deepEqual(now.map((o) => [o.id, o.targetUsd, o.nonceAccount]).sort(), before.map((o) => [o.id, o.targetUsd, o.nonceAccount]).sort(), "everything as it was");
  assert.ok(now.every((o) => o.txCiphertext), "the old signed orders are still stored");
  assert.ok(oldBytes.every((b) => !sim(b).err), "and still valid on chain");
  assert.equal((await pgListOrders(db, s.wallet)).filter((o) => o.groupId === s.gid).length, 2, "no new order was stored");
  assert.ok(!s.deps.audits.includes("panda_orders.modify"));
  // The browser asks again with the same body; this time the chain confirms.
  s.chain.sendMode = "land";
  assert.equal(await s.submit(body), "ok");
  assert.ok(oldBytes.every((b) => sim(b).err === "BlockhashNotFound"));
  assert.ok((await liveOf(s.wallet, s.gid)).every((o) => o.nonceAccount === s.reserve));
  // Asking yet again changes nothing more and sends nothing more.
  const sent = s.chain.sent.length;
  assert.equal(await s.submit(body), "ok");
  assert.equal(s.chain.sent.length, sent);
  assert.equal((await liveOf(s.wallet, s.gid)).length, 2);
});

test("the advance landed but its status came late: the next call still completes the change (never 'lost')", async () => {
  const s = await withLiveTranche("t-mod04");
  const p = await s.prepare({ sellUsd: 3 });
  const body = s.signedBody(p);
  s.chain.sendMode = "drop";
  assert.equal(await s.submit(body), "advance_pending");
  // It did land after all (the nonce moved) — exactly what a slow RPC looks like on the following call.
  landOnChain(s.chain, Buffer.from(body.advance, "base64"), true);
  assert.equal(await s.submit(body), "ok");
  assert.ok((await liveOf(s.wallet, s.gid)).every((o) => o.nonceAccount === s.reserve));
});

// ── cancelling ONE line of a pair ───────────────────────────────────────────────────────────────────────────────────

test("the × on ONE line of a pair: the old nonce is advanced (both old lines void on chain) and only the line that stays is signed again", async () => {
  const s = await withLiveTranche("t-leg01");
  const before = await liveOf(s.wallet, s.gid);
  const oldBytes = before.map(storedTx);
  const sim = nonceAwareSim(s.chain);
  const p = await s.prepare({ drop: "stop", riskAccepted: false });
  assert.deepEqual(p.orders.map((o) => o.leg), ["sell"], "one order to sign again: the sell that stays");
  assert.equal(await s.submit(s.signedBody(p)), "ok");
  assert.ok(oldBytes.every((b) => sim(b).err === "BlockhashNotFound"), "the cancelled stop (and the old sell) can never execute");
  const after = await liveOf(s.wallet, s.gid);
  assert.deepEqual(after.map((o) => [o.leg, o.nonceAccount, o.targetUsd]), [["sell", s.reserve, 2]]);
  assert.ok(!sim(storedTx(after[0])).err, "the sell keeps working");
  // The last line of an order isn't dropped this way: it is cancelled by closing the account (deposit back).
  const last = await prepareModify(s.deps, { ...s.base, drop: "sell", riskAccepted: false });
  assert.equal(last.ok === false && last.code, "last_leg");
  const none = await prepareModify(s.deps, { ...s.base, drop: "stop", riskAccepted: false });
  assert.equal(none.ok === false && none.code, "invalid", "there is no stop any more");
  // Another wallet can't touch it.
  const other = setup();
  const foreign = await prepareModify(other.deps, { ...s.base, wallet: other.wallet, drop: "sell", riskAccepted: false });
  assert.equal(foreign.ok === false && foreign.code, "nothing");
});

test("'Cancelar todo': one transaction closes every order account of that coin and, nothing being left, the reserve too", async () => {
  const s = await withLiveTranche("t-all01");
  const none = await closeNonces(s.deps, { wallet: s.wallet, allOf: Keypair.generate().publicKey.toBase58() });
  assert.equal(none.ok === false && none.code, "nothing");
  const bad = await closeNonces(s.deps, { wallet: s.wallet, allOf: "nope" });
  assert.equal(bad.ok === false && bad.code, "invalid");
  const r = await closeNonces(s.deps, { wallet: s.wallet, allOf: MINT });
  assert.ok(r.ok && r.nonceAccounts.length === 2 && r.nonceAccounts[0] === s.nonceAccount && r.nonceAccounts[1] === s.reserve);
  if (r.ok) assert.equal(r.lamports, 2 * 1_056_640, "both deposits come back");
});

// ── the same rules as a first order ─────────────────────────────────────────────────────────────────────────────────

test("moving the STOP asks for the risk warning again; a changed line obeys the rules of a first order; nothing changed = nothing to sign", async () => {
  const s = await withLiveTranche("t-mod05");
  const code = async (change: Record<string, unknown>) => {
    const r = await prepareModify(s.deps, { ...s.base, riskAccepted: true, ...change });
    return r.ok ? r.phase : `${r.code}${r.issues ? `:${Object.values(r.issues).flat().join(",")}` : ""}`;
  };
  assert.equal(await code({ stopUsd: 0.7, riskAccepted: false }), "risk_not_accepted");
  assert.equal(await code({ stopUsd: 1.5 }), "issues:stop_not_below_current");
  assert.equal(await code({ sellUsd: 0.9 }), "issues:sell_not_above_current");
  assert.equal(await code({ sellUsd: 2 }), "no_change");
  assert.equal(await code({ stopUsd: 0.7 }), "orders");
  assert.equal(await code({ sellUsd: 3, riskAccepted: false }), "orders", "moving only the sell doesn't ask for the stop warning");
});

test("changing the %: both lines are signed again for the new amount — never more than what other orders leave free", async () => {
  const s = await withLiveTranche("t-mod06");
  const p = await s.prepare({ pct: 40 });
  assert.equal(p.orders.length, 2);
  assert.equal(await s.submit(s.signedBody(p)), "ok");
  const after = await liveOf(s.wallet, s.gid);
  assert.ok(after.length === 2 && after.every((o) => o.pct === 40 && o.tokenAmountRaw === "400000"));
  s.chain.balances.set(s.wallet, BigInt(500_000));
  const tooMuch = await prepareModify(s.deps, { ...s.base, pct: 60, riskAccepted: true });
  assert.equal(tooMuch.ok === false && tooMuch.code, "no_balance");
});

test("everything is simulated and the SOL checked before the wallet opens", async () => {
  const s = await withLiveTranche("t-mod07");
  const code = async () => {
    const r = await prepareModify(s.deps, { ...s.base, sellUsd: 3, riskAccepted: true });
    return r.ok ? r.phase : r.code;
  };
  const real = nonceAwareSim(s.chain);
  s.chain.sim = () => ({ err: { InstructionError: [3, { Custom: 6023 }] }, logs: ["Error Code: NotEnoughTokensToSell."] });
  assert.equal(await code(), "no_balance");
  s.chain.sim = real;
  s.chain.sol.set(s.wallet, 1000);
  assert.equal(await code(), "insufficient_sol");
  s.chain.sol.delete(s.wallet);
  s.chain.simulated = 0;
  assert.equal(await code(), "orders");
  assert.equal(s.chain.simulated, 3, "the advance and both orders");
});

test("a wallet from before reserves existed: the change first creates the reserve (one deposit), then goes on as usual", async () => {
  const s = await withLiveTranche("t-mod08");
  s.chain.accounts.set(s.reserve, null);
  await pgSetNonceState(db, s.wallet, s.reserve, "closed", s.deps.clock.t);
  const first = await prepareModify(s.deps, { ...s.base, sellUsd: 3, riskAccepted: true });
  assert.ok(first.ok && first.phase === "setup" && first.nonceAccounts.length === 1 && first.rentLamports === 1_056_640);
  if (!first.ok || first.phase !== "setup") return;
  s.chain.accounts.set(first.nonceAccounts[0], nonceInfo(s.kp.publicKey, randomNonceValue()));
  const p = await s.prepare({ sellUsd: 3 });
  assert.equal(await s.submit(s.signedBody(p)), "ok");
  assert.ok((await liveOf(s.wallet, s.gid)).every((o) => o.nonceAccount === first.nonceAccounts[0]));
});

// ── what submit refuses ─────────────────────────────────────────────────────────────────────────────────────────────

test("submit refuses a forged or foreign ticket, a wrong or missing signature, an expired change, a nonce that moved, a reserve that was taken — sending NOTHING and changing NOTHING", async () => {
  const s = await withLiveTranche("t-mod09");
  const other = await withLiveTranche("t-mod10");
  const before = (await liveOf(s.wallet, s.gid)).map((o) => o.id).sort();
  const p = await s.prepare({ sellUsd: 3 });
  const good = s.signedBody(p);
  const q = other.signedBody(await other.prepare({ sellUsd: 3 }));
  // A ticket whose bytes were touched; another wallet's genuine ticket; this wallet's ticket presented for another tranche.
  const flipped = Buffer.from(p.ticket.ciphertext, "base64");
  flipped[5] ^= 1;
  assert.equal(await s.submit({ ...good, ticket: { ...p.ticket, ciphertext: flipped.toString("base64") } }), "invalid");
  assert.equal(await s.submit({ ...good, ticket: q.ticket }), "invalid");
  assert.equal(await s.submit({ ...good, trancheId: "t-other1" }), "invalid");
  // The advance signed by nobody / replaced by another transaction of the same wallet; an order missing or swapped.
  const forged = VersionedTransaction.deserialize(Buffer.from(p.advance, "base64"));
  forged.signatures[0] = Keypair.generate().secretKey.slice(0, 64);
  assert.equal(await s.submit({ ...good, advance: Buffer.from(forged.serialize()).toString("base64") }), "invalid_signature");
  assert.equal(await s.submit({ ...good, advance: p.advance }), "invalid_signature", "unsigned");
  assert.equal(await s.submit({ ...good, advance: good.signed[0].transaction }), "wallet_modified");
  assert.equal(await s.submit({ ...good, signed: good.signed.slice(0, 1) }), "invalid");
  assert.equal(await s.submit({ ...good, signed: [{ id: good.signed[0].id, transaction: good.signed[1].transaction }, { id: good.signed[1].id, transaction: good.signed[0].transaction }] }), "wallet_modified");
  // Too late.
  s.deps.clock.t += MODIFY_TTL_MS + 1;
  assert.equal(await s.submit(good), "expired");
  s.deps.clock.t -= MODIFY_TTL_MS + 1;
  // The reserve was taken by something else meanwhile (its nonce moved): the new orders would be dead paper.
  const reserveWas = s.chain.accounts.get(s.reserve)!;
  s.chain.accounts.set(s.reserve, nonceInfo(s.kp.publicKey, randomNonceValue()));
  assert.equal(await s.submit(good), "expired");
  s.chain.accounts.set(s.reserve, reserveWas);
  // The old order executed (or the user cancelled it) while signing: its nonce moved without this advance.
  const oldWas = s.chain.accounts.get(s.nonceAccount)!;
  s.chain.accounts.set(s.nonceAccount, nonceInfo(s.kp.publicKey, randomNonceValue()));
  assert.equal(await s.submit(good), "nonce_used");
  s.chain.accounts.set(s.nonceAccount, oldWas);
  // The watcher is sending the old order right now.
  const sell = (await liveOf(s.wallet, s.gid)).find((o) => o.leg === "sell")!;
  await pgTransition(db, sell.id, ["active"], { state: "sending" }, s.deps.clock.t);
  assert.equal(await s.submit(good), "nonce_used");
  await pgTransition(db, sell.id, ["sending"], { state: "active" }, s.deps.clock.t);

  assert.equal(s.chain.sent.length, 0, "through all of it, nothing was ever sent to the chain");
  assert.deepEqual((await liveOf(s.wallet, s.gid)).map((x) => x.id).sort(), before, "and nothing changed");
  // With everything right it goes through.
  assert.equal(await s.submit(good), "ok");
});

test("an order that is being executed, or already gone, can't be changed", async () => {
  const s = await withLiveTranche("t-mod11");
  s.chain.accounts.set(s.nonceAccount, nonceInfo(s.kp.publicKey, randomNonceValue()));
  const moved = await prepareModify(s.deps, { ...s.base, sellUsd: 3, riskAccepted: true });
  assert.equal(moved.ok === false && moved.code, "nonce_used");
  const none = await prepareModify(s.deps, { ...s.base, trancheId: "t-nope1", sellUsd: 3, riskAccepted: true });
  assert.equal(none.ok === false && none.code, "nothing");
  const noLeg = await withLiveTranche("t-mod12", { pct: 10, sellUsd: 2 });
  const r = await prepareModify(noLeg.deps, { ...noLeg.base, stopUsd: 0.5, riskAccepted: true });
  assert.equal(r.ok === false && r.code, "invalid", "a change can't add a line that was never signed");
});
