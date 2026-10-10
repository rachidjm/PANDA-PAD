import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign as edSign } from "node:crypto";
import bs58 from "bs58";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgListOrders, pgNonceAccounts } from "@/lib/db/panda-orders";
import { closeNonces, listOrders, prepareOrders, requiredLamports, submitOrders, type PrepareResult } from "./service";
import { cancelLeg, CANCEL_LEG_TTL_MS, prepareModify, submitModify, MODIFY_TTL_MS } from "./modify";
import { openTx } from "./crypto";
import { fakeVenue, newChain, nonceInfo, randomNonceValue, serviceDeps, TEST_ENV } from "./testing";

/**
 * Before anything is signed (enough SOL, every transaction simulated, an order account never created twice) and changing
 * a live order with one signature — on a real Postgres (PGlite) with a fake chain and real ed25519 signatures.
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

/** A wallet with one live tranche (sell at 2, stop at 0.5, 20%). */
async function withLiveTranche(trancheId: string, tranche: Record<string, unknown> = { pct: 20, sellUsd: 2, stopUsd: 0.5 }) {
  const s = setup();
  const gid = group();
  const tranches = [{ trancheId, ...tranche }];
  const first = await prepareOrders(s.deps, input(s.wallet, gid, tranches));
  if (!first.ok || first.phase !== "setup") throw new Error("expected setup");
  for (const a of first.nonceAccounts) s.chain.accounts.set(a, nonceInfo(s.kp.publicKey, randomNonceValue()));
  const r = (await prepareOrders(s.deps, input(s.wallet, gid, tranches))) as Extract<PrepareResult, { phase: "orders" }>;
  const done = await submitOrders(s.deps, { wallet: s.wallet, groupId: gid, signed: r.orders.map((o) => ({ id: o.id, transaction: sign(o.transaction, s.kp) })) });
  assert.equal(done.ok, true, JSON.stringify(done));
  return { ...s, gid, trancheId, nonceAccount: first.nonceAccounts[0] };
}
const liveOf = async (wallet: string, gid: string) => (await pgListOrders(db, wallet)).filter((o) => o.groupId === gid && o.state === "active");

// ── before any signature ────────────────────────────────────────────────────────────────────────────────────────────

test("not enough SOL for the deposit + fees: refused BEFORE any transaction is handed out, with how much is missing", async () => {
  const { chain, deps, wallet } = setup();
  chain.sol.set(wallet, 0);
  const r = await prepareOrders(deps, input(wallet, group(), [{ trancheId: "t-sol01", pct: 10, sellUsd: 2 }]));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "insufficient_sol");
  assert.deepEqual(r.detail, { needLamports: requiredLamports(1, 1, 1_056_640), haveLamports: 0 });
  assert.equal((await pgNonceAccounts(db, wallet)).length, 0, "no order account was even reserved");
  assert.equal(chain.simulated, 0);
});

test("the deposit covers every account to create: 3 tranches need 3 deposits", async () => {
  const { chain, deps, wallet } = setup();
  chain.sol.set(wallet, requiredLamports(3, 3, 1_056_640) - 1);
  const tranches = [1, 2, 3].map((k) => ({ trancheId: `t-sol1${k}`, pct: 10, sellUsd: 2 }));
  const short = await prepareOrders(deps, input(wallet, group(), tranches));
  assert.equal(short.ok === false && short.code, "insufficient_sol");
  chain.sol.set(wallet, requiredLamports(3, 3, 1_056_640));
  const ok = await prepareOrders(deps, input(wallet, group(), tranches));
  assert.equal(ok.ok && ok.phase, "setup");
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

// ── changing a live order ───────────────────────────────────────────────────────────────────────────────────────────

test("moving the SELL: one new transaction on the SAME nonce; the stop is untouched and the pair keeps working", async () => {
  const s = await withLiveTranche("t-mod01");
  const before = await liveOf(s.wallet, s.gid);
  const oldSell = before.find((o) => o.leg === "sell")!;
  const stop = before.find((o) => o.leg === "stop")!;
  const p = await prepareModify(s.deps, { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId, sellUsd: 3, riskAccepted: false });
  assert.equal(p.ok, true, JSON.stringify(p));
  if (!p.ok) return;
  assert.equal(p.orders.length, 1, "only the line that moved");
  assert.equal(p.orders[0].replaces, oldSell.id);
  assert.equal((await pgNonceAccounts(db, s.wallet)).length, 1, "no new order account, no new deposit");
  // Until it is signed, nothing has changed.
  assert.deepEqual((await liveOf(s.wallet, s.gid)).map((o) => o.id).sort(), before.map((o) => o.id).sort());
  const done = await submitModify(s.deps, { wallet: s.wallet, signed: p.orders.map((o) => ({ replaces: o.replaces, transaction: sign(o.transaction, s.kp), ticket: o.ticket })) });
  assert.equal(done.ok, true, JSON.stringify(done));
  const after = await liveOf(s.wallet, s.gid);
  assert.equal(after.length, 2);
  const newSell = after.find((o) => o.leg === "sell")!;
  assert.equal(newSell.targetUsd, 3);
  assert.equal(newSell.nonceAccount, oldSell.nonceAccount);
  assert.equal(newSell.nonceValue, oldSell.nonceValue, "same nonce value: whichever leg fills first still kills the other");
  assert.equal(newSell.tokenAmountRaw, oldSell.tokenAmountRaw);
  assert.equal(newSell.triggerOutLamports, 600_000, "200,000 tokens pay 200,000 now; at 3× → 600,000");
  assert.equal(newSell.feeLamports, Math.floor(newSell.minOutLamports / 100), "the same fee rule");
  assert.equal(after.find((o) => o.leg === "stop")!.id, stop.id, "the stop is the very same signed order");
  const old = (await pgListOrders(db, s.wallet)).find((o) => o.id === oldSell.id)!;
  assert.equal(old.state, "cancelled");
  assert.equal(old.reason, "replaced");
  assert.equal(old.txCiphertext, null, "the old signed transaction is erased");
  const bytes = openTx(newSell.id, { ciphertext: newSell.txCiphertext!, iv: newSell.txIv! }, TEST_ENV)!;
  assert.ok(VersionedTransaction.deserialize(bytes).signatures[0].some((b) => b !== 0));
  const listed = await listOrders(s.deps, { wallet: s.wallet, mint: MINT });
  assert.equal(listed.orders.filter((o) => o.groupId === s.gid).length, 2, "the replaced row isn't shown as a cancelled order");
  assert.equal(listed.committedRaw, "200000");
  assert.ok(s.deps.audits.includes("panda_orders.modify"));
});

test("if the user doesn't sign, the old order stays exactly as it was", async () => {
  const s = await withLiveTranche("t-mod02");
  const before = await liveOf(s.wallet, s.gid);
  const p = await prepareModify(s.deps, { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId, sellUsd: 4, riskAccepted: false });
  assert.equal(p.ok, true);
  const after = await liveOf(s.wallet, s.gid);
  assert.deepEqual(after.map((o) => [o.id, o.targetUsd, o.txCiphertext]), before.map((o) => [o.id, o.targetUsd, o.txCiphertext]));
});

test("moving the STOP asks for the risk warning again; the rules of a first order still apply", async () => {
  const s = await withLiveTranche("t-mod03");
  const base = { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId };
  const noRisk = await prepareModify(s.deps, { ...base, stopUsd: 0.7, riskAccepted: false });
  assert.equal(noRisk.ok === false && noRisk.code, "risk_not_accepted");
  const above = await prepareModify(s.deps, { ...base, stopUsd: 1.5, riskAccepted: true });
  assert.equal(above.ok === false && above.code, "issues");
  if (!above.ok) assert.deepEqual(above.issues, { [s.trancheId]: ["stop_not_below_current"] });
  const sellBelow = await prepareModify(s.deps, { ...base, sellUsd: 0.9, riskAccepted: true });
  assert.equal(sellBelow.ok === false && sellBelow.code, "issues");
  const same = await prepareModify(s.deps, { ...base, sellUsd: 2, riskAccepted: true });
  assert.equal(same.ok === false && same.code, "no_change");
  const ok = await prepareModify(s.deps, { ...base, stopUsd: 0.7, riskAccepted: true });
  assert.equal(ok.ok && ok.orders.length, 1);
});

test("changing the %: both legs are re-signed in one go, for the new amount — never more than what other orders leave free", async () => {
  const s = await withLiveTranche("t-mod04");
  const base = { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId, riskAccepted: true };
  const p = await prepareModify(s.deps, { ...base, pct: 40 });
  assert.equal(p.ok, true, JSON.stringify(p));
  if (!p.ok) return;
  assert.equal(p.orders.length, 2);
  const done = await submitModify(s.deps, { wallet: s.wallet, signed: p.orders.map((o) => ({ replaces: o.replaces, transaction: sign(o.transaction, s.kp), ticket: o.ticket })) });
  assert.equal(done.ok, true, JSON.stringify(done));
  const after = await liveOf(s.wallet, s.gid);
  assert.ok(after.length === 2 && after.every((o) => o.pct === 40 && o.tokenAmountRaw === "400000"));
  // 20% was 200,000 → 100% would be 1,000,000 = the whole balance: fine. With less in the wallet it isn't.
  s.chain.balances.set(s.wallet, BigInt(500_000));
  const tooMuch = await prepareModify(s.deps, { ...base, pct: 60 });
  assert.equal(tooMuch.ok === false && tooMuch.code, "no_balance");
});

test("the replacement is simulated and the SOL checked before the wallet opens", async () => {
  const s = await withLiveTranche("t-mod05");
  const base = { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId, riskAccepted: true };
  s.chain.sim = () => ({ err: { InstructionError: [3, { Custom: 6023 }] }, logs: ["Error Code: NotEnoughTokensToSell."] });
  const bad = await prepareModify(s.deps, { ...base, sellUsd: 3 });
  assert.equal(bad.ok === false && bad.code, "no_balance");
  s.chain.sim = () => ({ err: null, logs: [] });
  s.chain.sol.set(s.wallet, 1000);
  const poor = await prepareModify(s.deps, { ...base, sellUsd: 3 });
  assert.equal(poor.ok === false && poor.code, "insufficient_sol");
});

test("submit refuses: a forged or foreign ticket, another wallet's signature, an expired change, a nonce that moved — and changes NOTHING", async () => {
  const s = await withLiveTranche("t-mod06");
  const other = await withLiveTranche("t-mod07");
  const before = (await liveOf(s.wallet, s.gid)).map((o) => o.id).sort();
  const p = await prepareModify(s.deps, { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId, sellUsd: 3, riskAccepted: false });
  const q = await prepareModify(other.deps, { wallet: other.wallet, groupId: other.gid, trancheId: other.trancheId, sellUsd: 3, riskAccepted: false });
  if (!p.ok || !q.ok) throw new Error("prepare failed");
  const o = p.orders[0];
  const good = { replaces: o.replaces, transaction: sign(o.transaction, s.kp), ticket: o.ticket };
  const code = async (signed: unknown[], deps = s.deps, wallet = s.wallet) => {
    const r = await submitModify(deps, { wallet, signed });
    return r.ok ? "ok" : r.code;
  };
  // A ticket whose bytes were touched, and a genuine ticket from ANOTHER order.
  const flipped = Buffer.from(o.ticket.ciphertext, "base64");
  flipped[5] ^= 1;
  assert.equal(await code([{ ...good, ticket: { ...o.ticket, ciphertext: flipped.toString("base64") } }]), "invalid");
  assert.equal(await code([{ ...good, ticket: q.orders[0].ticket }]), "invalid");
  // Someone else's ticket + their own signature, sent from this session.
  assert.equal(await code([{ replaces: q.orders[0].replaces, transaction: sign(q.orders[0].transaction, other.kp), ticket: q.orders[0].ticket }]), "invalid");
  // The right ticket signed by another key, or the bytes changed by the wallet.
  const forged = VersionedTransaction.deserialize(Buffer.from(o.transaction, "base64"));
  forged.signatures[0] = Keypair.generate().secretKey.slice(0, 64); // 64 bytes that aren't this wallet's signature
  assert.equal(await code([{ ...good, transaction: Buffer.from(forged.serialize()).toString("base64") }]), "invalid_signature");
  const p2 = await prepareModify(s.deps, { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId, sellUsd: 5, riskAccepted: false });
  if (!p2.ok) throw new Error("prepare failed");
  assert.equal(await code([{ ...good, transaction: sign(p2.orders[0].transaction, s.kp) }]), "wallet_modified", "a ticket only fits the exact transaction it was made for");
  // Too late.
  s.deps.clock.t += MODIFY_TTL_MS + 1;
  assert.equal(await code([good]), "expired");
  s.deps.clock.t -= MODIFY_TTL_MS + 1;
  // The twin leg filled (or the user cancelled) while signing: the nonce moved on.
  const saved = s.chain.accounts.get(s.nonceAccount)!;
  s.chain.accounts.set(s.nonceAccount, nonceInfo(s.kp.publicKey, randomNonceValue()));
  assert.equal(await code([good]), "nonce_used");
  assert.deepEqual((await liveOf(s.wallet, s.gid)).map((x) => x.id).sort(), before, "nothing changed through any of it");
  // And with everything right it goes through — once.
  s.chain.accounts.set(s.nonceAccount, saved);
  assert.equal(await code([good]), "ok");
  assert.equal(await code([good]), "expired", "the same change can't be applied twice");
});

test("an order that is being executed, or already gone, can't be changed", async () => {
  const s = await withLiveTranche("t-mod08");
  const base = { wallet: s.wallet, groupId: s.gid, trancheId: s.trancheId, riskAccepted: true };
  s.chain.accounts.set(s.nonceAccount, nonceInfo(s.kp.publicKey, randomNonceValue()));
  const moved = await prepareModify(s.deps, { ...base, sellUsd: 3 });
  assert.equal(moved.ok === false && moved.code, "nonce_used");
  const none = await prepareModify(s.deps, { ...base, trancheId: "t-nope1", sellUsd: 3 });
  assert.equal(none.ok === false && none.code, "nothing");
  const noLeg = await withLiveTranche("t-mod09", { pct: 10, sellUsd: 2 });
  const r = await prepareModify(noLeg.deps, { wallet: noLeg.wallet, groupId: noLeg.gid, trancheId: noLeg.trancheId, stopUsd: 0.5, riskAccepted: true });
  assert.equal(r.ok === false && r.code, "invalid", "a change can't add a line that was never signed");
});

// ── cancelling one line / everything ────────────────────────────────────────────────────────────────────────────────

/** ed25519 signature of `message` by `kp`, base58 — what a wallet's signMessage returns. */
function signMessage(kp: Keypair, message: string): string {
  const k = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.slice(0, 32))]), format: "der", type: "pkcs8" });
  return bs58.encode(edSign(null, Buffer.from(message), k));
}
const DOMAIN = "launchonpanda.app";

test("the × on ONE line of a pair: a signed message cancels just that line; the other keeps working on the same account", async () => {
  const s = await withLiveTranche("t-leg01");
  const legs = await liveOf(s.wallet, s.gid);
  const sell = legs.find((o) => o.leg === "sell")!;
  const stop = legs.find((o) => o.leg === "stop")!;
  const ask = await cancelLeg(s.deps, { wallet: s.wallet, orderId: stop.id, domain: DOMAIN });
  assert.ok(ask.ok && "message" in ask);
  if (!ask.ok || !("message" in ask)) return;
  for (const part of [`Domain: ${DOMAIN}`, `Wallet: ${s.wallet}`, `Order: ${stop.id}`, "Stop 20% of TST", "does not move any funds"]) assert.ok(ask.message.includes(part), part);
  // No signature, someone else's signature, a signature for the OTHER line, an old request: nothing is cancelled.
  const tryWith = async (signature: string, issuedAt = ask.issuedAt, orderId = stop.id) => {
    const r = await cancelLeg(s.deps, { wallet: s.wallet, orderId, issuedAt, signature, domain: DOMAIN });
    return r.ok ? "ok" : r.code;
  };
  assert.equal(await tryWith(signMessage(Keypair.generate(), ask.message)), "invalid_signature");
  assert.equal(await tryWith(signMessage(s.kp, ask.message), ask.issuedAt, sell.id), "invalid_signature");
  assert.equal(await tryWith(signMessage(s.kp, ask.message.replace(DOMAIN, "evil.example"))), "invalid_signature");
  assert.equal(await tryWith(signMessage(s.kp, ask.message), ask.issuedAt - CANCEL_LEG_TTL_MS - 1), "expired");
  assert.equal((await liveOf(s.wallet, s.gid)).length, 2);
  assert.equal(await tryWith(signMessage(s.kp, ask.message)), "ok");
  const after = await liveOf(s.wallet, s.gid);
  assert.deepEqual(after.map((o) => o.id), [sell.id], "the sell is untouched");
  const gone = (await pgListOrders(db, s.wallet)).find((o) => o.id === stop.id)!;
  assert.equal(gone.state, "cancelled");
  assert.equal(gone.txCiphertext, null, "its signed transaction is erased");
  // The last line of an order isn't dropped this way: it is cancelled by closing the account (deposit back).
  const last = await cancelLeg(s.deps, { wallet: s.wallet, orderId: sell.id, domain: DOMAIN });
  assert.equal(last.ok === false && last.code, "last_leg");
  // Another wallet can't even ask.
  const other = setup();
  const foreign = await cancelLeg(other.deps, { wallet: other.wallet, orderId: sell.id, domain: DOMAIN });
  assert.equal(foreign.ok === false && foreign.code, "nothing");
});

test("'Cancelar todo': one transaction closes every order account of that coin — and only of that coin", async () => {
  const s = await withLiveTranche("t-all01");
  const r = await closeNonces(s.deps, { wallet: s.wallet, allOf: MINT });
  assert.ok(r.ok && r.nonceAccounts.length === 1 && r.nonceAccounts[0] === s.nonceAccount);
  const none = await closeNonces(s.deps, { wallet: s.wallet, allOf: Keypair.generate().publicKey.toBase58() });
  assert.equal(none.ok === false && none.code, "nothing");
  const bad = await closeNonces(s.deps, { wallet: s.wallet, allOf: "nope" });
  assert.equal(bad.ok === false && bad.code, "invalid");
});
