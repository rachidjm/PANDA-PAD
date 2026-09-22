import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import type { TriggerOrder } from "@/lib/jupiter/trigger";
import { createStrategy, prepareStrategy, syncStrategies, type Deps, type PrepareInput } from "./service";
import { deriveStatus, canAdvance } from "./status";
import { listStrategies, PREPARED_TTL_MS } from "./store";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let counter = 0;
/** A distinct, valid wallet address per call (deterministic bytes — Keypair.generate is very slow in pure JS). */
const wallet = () => new PublicKey(Buffer.alloc(32, ++counter)).toBase58();

type Calls = { craft: number; create: number; list: number; feeSent: number };

function fakeDeps(over: Partial<Deps> = {}, orders: () => TriggerOrder[] = () => []): { deps: Deps; calls: Calls; clock: { t: number } } {
  const calls: Calls = { craft: 0, create: 0, list: 0, feeSent: 0 };
  const clock = { t: 1_000_000 };
  const deps: Deps = {
    now: () => clock.t,
    engineConfigured: () => true,
    quote: async () => ({ tokenUsd: 1, solUsd: 200, usdcUsd: 1, eurUsd: 1.1, liquidityUsd: 200_000 }),
    jupiter: {
      craftDeposit: async () => {
        calls.craft++;
        return { transaction: "tx".repeat(200), requestId: `req-${calls.craft}`, receiverAddress: "vault", mint: MINT, amount: "1", tokenDecimals: 6 };
      },
      createOrder: async () => {
        calls.create++;
        return { id: `order-${calls.create}` };
      },
      listOrders: async (_t, p) => {
        calls.list++;
        const all = orders();
        return { orders: all.filter((o) => (p.state === "active" ? !["filled", "cancelled", "expired", "failed"].includes(o.orderState) : ["filled", "cancelled", "expired", "failed"].includes(o.orderState))) };
      },
    },
    verifyTx: async () => true,
    fee: {
      treasury: "TREASURY",
      canReceive: async () => true,
      build: async () => "feetx".repeat(30),
      check: (signed) => (signed === "GOODFEE" ? { ok: true } : { ok: false, reason: "bad" }),
      send: async () => {
        calls.feeSent++;
        return "FEESIG";
      },
    },
    ...over,
  };
  return { deps, calls, clock };
}

const input = (w: string, over: Partial<PrepareInput> = {}): PrepareInput => ({
  wallet: w,
  token: "jwt",
  id: "strategy-0001",
  n: 1,
  mint: MINT,
  ticker: "PRINTER",
  buyUsd: 0.9,
  sellUsd: 1.4,
  stopUsd: 0.7,
  amount: { unit: "USD", value: 100 },
  fundingAsset: null,
  ...over,
});

const order = (id: string, over: Partial<TriggerOrder> = {}): TriggerOrder => ({
  id,
  orderType: "otoco",
  orderState: "open",
  inputMint: "",
  initialInputAmount: "1",
  remainingInputAmount: "1",
  outputMint: MINT,
  triggerMint: MINT,
  triggerCondition: "below",
  triggerPriceUsd: 0.9,
  expiresAt: 0,
  createdAt: 0,
  updatedAt: 0,
  events: [],
  ...over,
});

const buyEvt = { type: "fill", txSignature: "SIG_BUY", orderContext: "buy_below", outputAmount: "100" };
const tpEvt = { type: "fill", txSignature: "SIG_TP", orderContext: "take_profit", outputAmount: "1" };
const slEvt = { type: "fill", txSignature: "SIG_SL", orderContext: "stop_loss", outputAmount: "1" };

test("prepare: builds the deposit from the server's own numbers and stores the strategy (persisted)", async () => {
  const w = wallet();
  const { deps, calls } = fakeDeps();
  const r = await prepareStrategy(deps, input(w));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.record.state, "prepared");
  assert.equal(r.record.triggerCondition, "below"); // buy 0.9 is under the live price of 1
  assert.equal(r.record.fundingAsset, "SOL"); // no balances known → SOL; 100 USD at 200 USD/SOL
  assert.equal(r.record.inputAmountRaw, "500000000");
  assert.equal(calls.craft, 1);
  const saved = await listStrategies(w, 1_000_000);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, "strategy-0001");
});

test("prepare: a BUY target above the price becomes an 'above' trigger", async () => {
  const { deps } = fakeDeps();
  const r = await prepareStrategy(deps, input(wallet(), { buyUsd: 1.2, sellUsd: 1.8, stopUsd: 1 }));
  assert.ok(r.ok && r.record.triggerCondition === "above");
});

test("prepare: EUR and USDC funding are converted with the server's rates, not the browser's", async () => {
  const { deps } = fakeDeps();
  const eur = await prepareStrategy(deps, input(wallet(), { amount: { unit: "EUR", value: 100 }, fundingAsset: "USDC" }));
  assert.ok(eur.ok);
  if (eur.ok) {
    assert.equal(eur.record.fundingAsset, "USDC");
    assert.equal(eur.record.inputAmountRaw, "110000000"); // 100 EUR = 110 USD = 110 USDC
    assert.ok(Math.abs(eur.record.amountUsd - 110) < 1e-9);
  }
  const usdc = await prepareStrategy(deps, input(wallet(), { id: "strategy-0002", amount: { unit: "USDC", value: 25 } }));
  assert.ok(usdc.ok && usdc.record.inputAmountRaw === "25000000");
  const sol = await prepareStrategy(deps, input(wallet(), { id: "strategy-0003", amount: { unit: "SOL", value: 0.25 } }));
  assert.ok(sol.ok && sol.record.inputAmountRaw === "250000000" && sol.record.fundingAsset === "SOL");
});

test("prepare: refuses what is unsafe or invalid, and never calls Jupiter for it", async () => {
  const cases: Array<[string, Partial<PrepareInput>, string]> = [
    ["sell below buy", { sellUsd: 0.8 }, "issues"],
    ["stop above buy", { stopUsd: 0.95 }, "issues"],
    ["below the 10 USD minimum", { amount: { unit: "USD", value: 5 } }, "issues"],
    ["bad mint", { mint: "not-a-mint" }, "invalid"],
    ["bad id", { id: "x" }, "invalid"],
    ["bad number", { buyUsd: "1.2" as unknown as number }, "invalid"],
    ["bad unit", { amount: { unit: "GBP", value: 100 } }, "invalid"],
  ];
  for (const [name, over, code] of cases) {
    const { deps, calls } = fakeDeps();
    const r = await prepareStrategy(deps, input(wallet(), over));
    assert.equal(r.ok, false, name);
    if (!r.ok) assert.equal(r.code, code, name);
    assert.equal(calls.craft, 0, name);
  }
});

test("prepare: unknown or thin liquidity, no price and a missing EUR rate are refused (fail closed)", async () => {
  const thin = fakeDeps({ quote: async () => ({ tokenUsd: 1, solUsd: 200, usdcUsd: 1, eurUsd: 1.1, liquidityUsd: 800 }) });
  const r1 = await prepareStrategy(thin.deps, input(wallet()));
  assert.ok(!r1.ok && r1.issues?.includes("liquidity_low"));
  const unknown = fakeDeps({ quote: async () => ({ tokenUsd: 1, solUsd: 200, usdcUsd: 1, eurUsd: 1.1, liquidityUsd: null }) });
  const r2 = await prepareStrategy(unknown.deps, input(wallet()));
  assert.ok(!r2.ok && r2.issues?.includes("liquidity_unknown"));
  const noPrice = fakeDeps({ quote: async () => ({ tokenUsd: null, solUsd: 200, usdcUsd: 1, eurUsd: 1.1, liquidityUsd: 100_000 }) });
  const r3 = await prepareStrategy(noPrice.deps, input(wallet()));
  assert.ok(!r3.ok && r3.code === "price_unavailable");
  const noEur = fakeDeps({ quote: async () => ({ tokenUsd: 1, solUsd: 200, usdcUsd: 1, eurUsd: null, liquidityUsd: 100_000 }) });
  const r4 = await prepareStrategy(noEur.deps, input(wallet(), { amount: { unit: "EUR", value: 100 } }));
  assert.ok(!r4.ok && r4.code === "price_unavailable");
});

test("without the Jupiter key nothing is prepared, created or synced — no pretend execution", async () => {
  const { deps, calls } = fakeDeps({ engineConfigured: () => false });
  const w = wallet();
  const a = await prepareStrategy(deps, input(w));
  const b = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "x".repeat(200) });
  const c = await syncStrategies(deps, { wallet: w, token: "jwt" });
  for (const r of [a, b, c]) assert.ok(!r.ok && r.code === "engine_unavailable");
  assert.equal(calls.craft + calls.create + calls.list, 0);
  assert.equal((await listStrategies(w, 1_000_000)).length, 0);
});

test("create: submits the order exactly as prepared (stored values, not the browser's) → WAITING", async () => {
  const w = wallet();
  let sent: Record<string, unknown> = {};
  const { deps } = fakeDeps({
    jupiter: {
      craftDeposit: async () => ({ transaction: "tx".repeat(200), requestId: "req-1", receiverAddress: "v", mint: MINT, amount: "1", tokenDecimals: 6 }),
      createOrder: async (p) => {
        sent = p as unknown as Record<string, unknown>;
        return { id: "order-1" };
      },
      listOrders: async () => ({ orders: [] }),
    },
  });
  assert.ok((await prepareStrategy(deps, input(w))).ok);
  const r = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.record.state, "waiting");
  assert.equal(r.record.jupiterOrderId, "order-1");
  assert.equal(sent.orderType, "otoco");
  assert.equal(sent.triggerPriceUsd, 0.9);
  assert.equal(sent.tpPriceUsd, 1.4);
  assert.equal(sent.slPriceUsd, 0.7);
  assert.equal(sent.triggerMint, MINT);
  assert.equal(sent.outputMint, MINT);
  assert.equal(sent.userPubkey, w);
  assert.equal(sent.depositRequestId, "req-1");
  assert.equal(sent.inputAmount, "500000000");
});

test("create twice for the same strategy: the second is refused and Jupiter is called once (idempotency)", async () => {
  const w = wallet();
  const { deps, calls } = fakeDeps();
  await prepareStrategy(deps, input(w));
  const args = { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" };
  const [a, b] = await Promise.all([createStrategy(deps, args), createStrategy(deps, args)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(calls.create, 1);
  const again = await createStrategy(deps, args);
  assert.ok(!again.ok && again.code === "conflict");
  assert.equal(calls.create, 1);
});

test("a strategy can't be re-prepared once submitted, and can be re-prepared before", async () => {
  const w = wallet();
  const { deps, calls } = fakeDeps();
  assert.ok((await prepareStrategy(deps, input(w))).ok);
  assert.ok((await prepareStrategy(deps, input(w))).ok); // wallet popup closed, try again
  assert.equal((await listStrategies(w, 1_000_000)).length, 1);
  await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  const r = await prepareStrategy(deps, input(w));
  assert.ok(!r.ok && r.code === "conflict");
  assert.equal(calls.create, 1);
});

test("a wallet can't create (or see) another wallet's strategy", async () => {
  const a = wallet();
  const b = wallet();
  const { deps } = fakeDeps();
  await prepareStrategy(deps, input(a));
  const r = await createStrategy(deps, { wallet: b, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(!r.ok && r.code === "not_found");
  assert.equal((await listStrategies(b, 1_000_000)).length, 0);
});

test("create: an order Jupiter rejects becomes FAILED with the reason, and can't be submitted again", async () => {
  const w = wallet();
  const { deps } = fakeDeps({
    jupiter: {
      craftDeposit: async () => ({ transaction: "tx".repeat(200), requestId: "r", receiverAddress: "v", mint: MINT, amount: "1", tokenDecimals: 6 }),
      createOrder: async () => {
        throw new Error("Jupiter Trigger API /orders/price failed (400): unsupported token");
      },
      listOrders: async () => ({ orders: [] }),
    },
  });
  await prepareStrategy(deps, input(w));
  const r = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(!r.ok && r.code === "jupiter_error");
  const [s] = await listStrategies(w, 1_000_000);
  assert.equal(s.state, "failed");
  assert.match(s.error ?? "", /unsupported token/);
  const again = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(!again.ok && again.code === "conflict");
});

test("create: a prepared deposit that sat too long is refused", async () => {
  const w = wallet();
  const { deps, clock, calls } = fakeDeps();
  await prepareStrategy(deps, input(w));
  clock.t += PREPARED_TTL_MS + 1;
  const r = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(!r.ok && r.code === "expired");
  assert.equal(calls.create, 0);
});

test("sync walks WAITING → POSITION OPEN → COMPLETED only on verified fills, and persists", async () => {
  const w = wallet();
  let current: TriggerOrder[] = [];
  const { deps } = fakeDeps({}, () => current);
  await prepareStrategy(deps, input(w));
  await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });

  current = [order("order-1", { orderState: "open" })];
  let r = await syncStrategies(deps, { wallet: w, token: "jwt" });
  assert.ok(r.ok && r.strategies[0].state === "waiting");

  current = [order("order-1", { orderState: "filled", events: [buyEvt] })];
  r = await syncStrategies(deps, { wallet: w, token: "jwt" });
  assert.ok(r.ok && r.strategies[0].state === "position_open" && r.strategies[0].buySignature === "SIG_BUY");

  current = [order("order-1", { orderState: "filled", events: [buyEvt, tpEvt] })];
  r = await syncStrategies(deps, { wallet: w, token: "jwt" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.strategies[0].state, "completed");
  assert.equal(r.strategies[0].sellSignature, "SIG_TP");
  assert.equal(r.strategies[0].sellKind, "take_profit");

  // A later read (a new "session") sees the same thing.
  assert.equal((await listStrategies(w, 1_000_000))[0].state, "completed");
});

test("a completed strategy never changes again, even if Jupiter later reports something else", async () => {
  const w = wallet();
  let current: TriggerOrder[] = [order("order-1", { orderState: "filled", events: [buyEvt, slEvt] })];
  const { deps } = fakeDeps({}, () => current);
  await prepareStrategy(deps, input(w));
  await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  await syncStrategies(deps, { wallet: w, token: "jwt" });
  current = [order("order-1", { orderState: "open", events: [] })];
  const r = await syncStrategies(deps, { wallet: w, token: "jwt" });
  assert.ok(r.ok && r.strategies[0].state === "completed" && r.strategies[0].sellKind === "stop_loss");
});

test("status: the price touching a line proves nothing — a fill with no verified transaction is not counted", async () => {
  const unverified = await deriveStatus(order("o", { orderState: "filled", events: [buyEvt] }), async () => false);
  assert.equal(unverified.status, null);
  const noSig = await deriveStatus(order("o", { orderState: "filled", events: [{ type: "fill", orderContext: "buy_below" }] }), async () => true);
  assert.equal(noSig.status, null);
});

test("status: SELL before BUY is impossible — an exit fill without a proven entry is ignored", async () => {
  const d = await deriveStatus(order("o", { orderState: "filled", events: [tpEvt] }), async () => true);
  assert.notEqual(d.status, "completed");
  assert.equal(d.sellSignature, undefined);
  const d2 = await deriveStatus(order("o", { orderState: "open", events: [tpEvt] }), async (sig) => sig !== "SIG_BUY");
  assert.notEqual(d2.status, "completed");
  const d3 = await deriveStatus(order("o", { orderState: "open", events: [buyEvt, tpEvt] }), async (sig) => sig === "SIG_TP");
  assert.notEqual(d3.status, "completed"); // exit verified but entry isn't
});

test("status: executing before any fill is BUY TRIGGERED; an executing exit is SELL TRIGGERED", async () => {
  assert.equal((await deriveStatus(order("o", { orderState: "executing" }), async () => true)).status, "buy_triggered");
  assert.equal((await deriveStatus(order("o", { orderState: "executing", events: [buyEvt] }), async () => true)).status, "sell_triggered");
  assert.equal((await deriveStatus(order("o", { orderState: "pending" }), async () => true)).status, "waiting");
});

test("status: failed BUY → FAILED; failed SELL after a bought position → FAILED and the tokens are flagged as held", async () => {
  const failedBuy = await deriveStatus(order("o", { orderState: "failed" }), async () => true);
  assert.equal(failedBuy.status, "failed");
  assert.equal(failedBuy.holdsTokens, undefined);
  const failedSell = await deriveStatus(order("o", { orderState: "failed", events: [buyEvt] }), async () => true);
  assert.equal(failedSell.status, "failed");
  assert.equal(failedSell.holdsTokens, true);
});

test("status: cancelled and expired orders are CANCELLED (holding tokens is flagged when the entry filled)", async () => {
  assert.equal((await deriveStatus(order("o", { orderState: "cancelled" }), async () => true)).status, "cancelled");
  const expired = await deriveStatus(order("o", { orderState: "expired", events: [buyEvt] }), async () => true);
  assert.equal(expired.status, "cancelled");
  assert.equal(expired.holdsTokens, true);
});

test("status: an unrecognised state changes nothing instead of guessing", async () => {
  const d = await deriveStatus(order("o", { orderState: "pending_withdraw" }), async () => true);
  assert.equal(d.status, null);
  assert.ok(d.unrecognised);
});

test("a state never goes backwards and terminal states are final", () => {
  assert.equal(canAdvance("position_open", "waiting"), false);
  assert.equal(canAdvance("waiting", "position_open"), true);
  assert.equal(canAdvance("completed", "cancelled"), false);
  assert.equal(canAdvance("failed", "waiting"), false);
  assert.equal(canAdvance("prepared", "waiting"), false);
  assert.equal(canAdvance("position_open", "cancelled"), true);
});

test("sync leaves things alone when Jupiter is unreachable (reports the error, changes nothing)", async () => {
  const w = wallet();
  let fail = false;
  const { deps } = fakeDeps({
    jupiter: {
      craftDeposit: async () => ({ transaction: "tx".repeat(200), requestId: "r", receiverAddress: "v", mint: MINT, amount: "1", tokenDecimals: 6 }),
      createOrder: async () => ({ id: "order-1" }),
      listOrders: async () => {
        if (fail) throw new Error("down");
        return { orders: [] };
      },
    },
  });
  await prepareStrategy(deps, input(w));
  await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  fail = true;
  const r = await syncStrategies(deps, { wallet: w, token: "jwt" });
  assert.ok(!r.ok && r.code === "jupiter_error");
  assert.equal((await listStrategies(w, 1_000_000))[0].state, "waiting");
});

test("several strategies on one wallet are kept apart", async () => {
  const w = wallet();
  const { deps } = fakeDeps();
  await prepareStrategy(deps, input(w, { id: "strategy-0001", n: 1 }));
  await prepareStrategy(deps, input(w, { id: "strategy-0002", n: 2, buyUsd: 0.8, sellUsd: 1.6, stopUsd: 0.6 }));
  await prepareStrategy(deps, input(w, { id: "strategy-0003", n: 3, buyUsd: 1.6, sellUsd: 2.3, stopUsd: 1.3 }));
  await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0002", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  const all = await listStrategies(w, 1_000_000);
  assert.deepEqual(all.map((s) => [s.n, s.state]), [[1, "prepared"], [2, "waiting"], [3, "prepared"]]);
  assert.equal(all[2].triggerCondition, "above");
});

// ---- PANDA's fee: added to what the user pays, collected when the strategy is confirmed --------------------------------

test("fee: prepare works out 1% (0.5% buy + 0.5% sell) of the amount in SOL from the server's rate and hands back the fee transaction", async () => {
  const w = wallet();
  const { deps } = fakeDeps();
  const r = await prepareStrategy(deps, input(w)); // 100 USD at 200 USD per SOL
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.record.feeLamports, 5_000_000); // $1 = 0.005 SOL
  assert.equal(r.record.feeState, "prepared");
  assert.ok(r.feeTransaction && r.feeTransaction.length > 100);
  assert.equal(r.record.inputAmountRaw, "500000000"); // the deposit is still the full amount: the fee is on top, not taken out of it
});

test("fee: no fee payment, or a wrong one, and Jupiter is never called", async () => {
  const w = wallet();
  const { deps, calls } = fakeDeps();
  await prepareStrategy(deps, input(w));
  for (const feeSignedTx of [undefined, "", "WRONGFEE"]) {
    const r = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx });
    assert.ok(!r.ok && r.code === "invalid");
  }
  assert.equal(calls.create, 0);
  assert.equal(calls.feeSent, 0);
  // and the strategy is still there to be confirmed properly
  const ok = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(ok.ok);
});

test("fee: charged once, only after Jupiter accepted the order, and recorded as paid", async () => {
  const w = wallet();
  const order: string[] = [];
  const { deps } = fakeDeps({
    jupiter: {
      craftDeposit: async () => ({ transaction: "tx".repeat(200), requestId: "r", receiverAddress: "v", mint: MINT, amount: "1", tokenDecimals: 6 }),
      createOrder: async () => {
        order.push("order");
        return { id: "order-1" };
      },
      listOrders: async () => ({ orders: [] }),
    },
    fee: {
      treasury: "TREASURY",
      canReceive: async () => true,
      build: async () => "feetx".repeat(30),
      check: () => ({ ok: true }),
      send: async () => {
        order.push("fee");
        return "FEESIG";
      },
    },
  });
  await prepareStrategy(deps, input(w));
  const args = { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" };
  const [a, b] = await Promise.all([createStrategy(deps, args), createStrategy(deps, args)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.deepEqual(order, ["order", "fee"]); // the order first, the fee after, and each exactly once
  const [s] = await listStrategies(w, 1_000_000);
  assert.equal(s.feeState, "paid");
  assert.equal(s.feeSignature, "FEESIG");
});

test("fee: if Jupiter refuses the order, nothing is charged", async () => {
  const w = wallet();
  const { deps, calls } = fakeDeps({
    jupiter: {
      craftDeposit: async () => ({ transaction: "tx".repeat(200), requestId: "r", receiverAddress: "v", mint: MINT, amount: "1", tokenDecimals: 6 }),
      createOrder: async () => {
        throw new Error("rejected");
      },
      listOrders: async () => ({ orders: [] }),
    },
  });
  await prepareStrategy(deps, input(w));
  const r = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(!r.ok);
  assert.equal(calls.feeSent, 0);
  assert.equal((await listStrategies(w, 1_000_000))[0].feeState, "prepared");
});

test("fee: if the fee transfer itself fails after the order exists, the strategy stays live and the failure is recorded", async () => {
  const w = wallet();
  const { deps } = fakeDeps({
    fee: {
      treasury: "TREASURY",
      canReceive: async () => true,
      build: async () => "feetx".repeat(30),
      check: () => ({ ok: true }),
      send: async () => {
        throw new Error("blockhash expired");
      },
    },
  });
  await prepareStrategy(deps, input(w));
  const r = await createStrategy(deps, { wallet: w, token: "jwt", id: "strategy-0001", depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.ok(r.ok);
  const [s] = await listStrategies(w, 1_000_000);
  assert.equal(s.state, "waiting");
  assert.equal(s.feeState, "failed");
  assert.match(s.feeError ?? "", /blockhash/);
});

test("fee: without a SOL rate the fee can't be worked out, so nothing is prepared", async () => {
  const { deps, calls } = fakeDeps({ quote: async () => ({ tokenUsd: 1, solUsd: null, usdcUsd: 1, eurUsd: 1.1, liquidityUsd: 200_000 }) });
  const r = await prepareStrategy(deps, input(wallet(), { amount: { unit: "USDC", value: 100 } }));
  assert.ok(!r.ok && r.code === "price_unavailable");
  assert.equal(calls.craft, 0);
});
