import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import type { CreateOrderParams, DepositCraft, TriggerOrder } from "@/lib/jupiter/trigger";
import { createStrategy, prepareStrategy, type Deps, type PrepareInput } from "./service";
import { deriveHeldStatus } from "./status";
import { listStrategies } from "./store";

/**
 * Every order shape end to end through the service, with fake Jupiter/chain dependencies: what is asked for at each
 * step (the deposit and the create-order request), and that a refused shape never crafts a deposit at all.
 */

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = MINT;
const DECIMALS = 6;
const HELD_RAW = BigInt(100_000_000); // 100 tokens

let counter = 0;
const wallet = () => new PublicKey(Buffer.alloc(32, ++counter)).toBase58();
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

type Seen = { deposits: Parameters<Deps["jupiter"]["craftDeposit"]>[0][]; orders: CreateOrderParams[] };

function fakeDeps(over: Partial<Deps> = {}, held = HELD_RAW): { deps: Deps; seen: Seen; clock: { t: number } } {
  const seen: Seen = { deposits: [], orders: [] };
  const clock = { t: 1_000_000 };
  const deps: Deps = {
    now: () => clock.t,
    engineConfigured: () => true,
    quote: async () => ({ tokenUsd: 1, solUsd: 200, usdcUsd: 1, eurUsd: 1.1, liquidityUsd: 200_000, priceChangeH1Pct: null }),
    feeBps: async () => 50,
    jupiter: {
      craftDeposit: async (params) => {
        seen.deposits.push(params);
        return { transaction: "tx".repeat(200), requestId: `req-${seen.deposits.length}`, receiverAddress: "vault", mint: params.inputMint, amount: params.amount, tokenDecimals: DECIMALS } as DepositCraft;
      },
      createOrder: async (params) => {
        seen.orders.push(params);
        return { id: `order-${seen.orders.length}` };
      },
      listOrders: async () => ({ orders: [] }),
    },
    verifyTx: async () => true,
    balance: async () => ({ raw: held, decimals: DECIMALS }),
    fee: {
      treasury: "TREASURY",
      canReceive: async () => true,
      build: async () => "feetx".repeat(30),
      check: () => ({ ok: true }),
      send: async () => "FEESIG",
    },
    ...over,
  };
  return { deps, seen, clock };
}

const base = (w: string, over: Partial<PrepareInput>): PrepareInput => ({
  wallet: w,
  token: "jwt",
  id: newId("shape"),
  n: 1,
  mint: MINT,
  ticker: "TST",
  buyUsd: undefined,
  sellUsd: undefined,
  stopUsd: undefined,
  amount: { unit: "USD", value: 50 },
  fundingAsset: "USDC",
  ...over,
});

// ── buy only ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("buy only: one single buy from the funding asset, triggered below the buy target, and the create-order request is a single", async () => {
  const { deps, seen } = fakeDeps();
  const w = wallet();
  const prepared = await prepareStrategy(deps, base(w, { buyUsd: 0.5, amount: { unit: "USD", value: 50 } }));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(seen.deposits[0].orderSubType, "single");
  assert.equal(seen.deposits[0].inputMint, USDC);
  assert.equal(prepared.record.kind, "buy");

  const created = await createStrategy(deps, { wallet: w, token: "jwt", id: prepared.record.id, depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.equal(created.ok, true);
  const order = seen.orders[0];
  assert.equal(order.orderType, "single");
  assert.equal(order.inputMint, USDC);
  assert.equal(order.outputMint, MINT);
  assert.equal(order.triggerPriceUsd, 0.5);
  assert.equal(order.triggerCondition, "below");
});

// ── sell / stop on a held coin: never Jupiter ─────────────────────────────────────────────────────────────────────

for (const [name, legs] of [
  ["sell only", { sellUsd: 2 }],
  ["stop only", { stopUsd: 0.5 }],
  ["sell + stop", { sellUsd: 2, stopUsd: 0.5 }],
] as const) {
  test(`${name} with no buy is refused: it's a PANDA order, never a Jupiter one (no deposit, no order)`, async () => {
    const { deps, seen } = fakeDeps();
    const r = await prepareStrategy(deps, base(wallet(), { ...legs, sellPct: 25 }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "panda_orders_only");
    assert.equal(seen.deposits.length, 0);
    assert.equal(seen.orders.length, 0);
  });
}

// ── buy + sell + stop (otoco, unchanged) ───────────────────────────────────────────────────────────────────────────

test("buy + sell + stop: still the full otoco, exactly as before", async () => {
  const { deps, seen } = fakeDeps();
  const w = wallet();
  const prepared = await prepareStrategy(deps, base(w, { buyUsd: 0.5, sellUsd: 2, stopUsd: 0.3 }));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(seen.deposits[0].orderSubType, "otoco");
  await createStrategy(deps, { wallet: w, token: "jwt", id: prepared.record.id, depositSignedTx: "s".repeat(200), feeSignedTx: "GOODFEE" });
  assert.equal(seen.orders[0].orderType, "otoco");
  assert.equal(seen.orders[0].triggerPriceUsd, 0.5);
  assert.equal(seen.orders[0].tpPriceUsd, 2);
  assert.equal(seen.orders[0].slPriceUsd, 0.3);
});

// ── combinations that are NOT offered ──────────────────────────────────────────────────────────────────────────────

test("buy + sell (no stop) is refused by the server, with no deposit", async () => {
  const { deps, seen } = fakeDeps();
  const res = await prepareStrategy(deps, base(wallet(), { buyUsd: 0.5, sellUsd: 2 }));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.status, 400);
  assert.equal(seen.deposits.length, 0);
});

test("buy + stop (no sell) is refused by the server, with no deposit", async () => {
  const { deps, seen } = fakeDeps();
  const res = await prepareStrategy(deps, base(wallet(), { buyUsd: 0.5, stopUsd: 0.3 }));
  assert.equal(res.ok, false);
  assert.equal(seen.deposits.length, 0);
});

test("a price that isn't a positive number is refused, whatever the shape", async () => {
  const { deps, seen } = fakeDeps();
  const res = await prepareStrategy(deps, base(wallet(), { sellUsd: -2, sellPct: 50 }));
  assert.equal(res.ok, false);
  assert.equal(seen.deposits.length, 0);
});

// ── the held-token status rule ─────────────────────────────────────────────────────────────────────────────────────

const order = (over: Partial<TriggerOrder>): TriggerOrder => ({
  id: "o",
  orderType: "single",
  orderState: "open",
  inputMint: MINT,
  initialInputAmount: "1",
  remainingInputAmount: "1",
  outputMint: SOL,
  triggerMint: MINT,
  triggerCondition: "above",
  triggerPriceUsd: 2,
  expiresAt: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

test("held status: a filled order is completed only with a verified fill signature", async () => {
  const filled = order({ orderState: "filled", events: [{ type: "fill", txSignature: "SIG1", orderContext: "take_profit" }] });
  const ok = await deriveHeldStatus(filled, async () => true);
  assert.equal(ok.status, "completed");
  assert.equal(ok.sellSignature, "SIG1");
  assert.equal(ok.sellKind, "take_profit");
  const unverified = await deriveHeldStatus(filled, async () => false);
  assert.equal(unverified.status, null, "a fill that isn't confirmed on-chain counts for nothing");
});

test("held status: a standalone fill with no documented context still completes, without inventing a sell kind", async () => {
  const filled = order({ orderState: "filled", events: [{ type: "fill", txSignature: "SIG2", orderContext: "something_else" }] });
  const d = await deriveHeldStatus(filled, async () => true);
  assert.equal(d.status, "completed");
  assert.equal(d.sellKind, undefined);
});

test("held status: executing is sell_triggered, open is waiting, cancelled and failed are final", async () => {
  assert.equal((await deriveHeldStatus(order({ orderState: "executing" }), async () => true)).status, "sell_triggered");
  assert.equal((await deriveHeldStatus(order({ orderState: "open" }), async () => true)).status, "waiting");
  assert.equal((await deriveHeldStatus(order({ orderState: "cancelled" }), async () => true)).status, "cancelled");
  assert.equal((await deriveHeldStatus(order({ orderState: "failed" }), async () => true)).status, "failed");
});

test("the shapes are stored with their kind, so a later sync reads them with the right rule", async () => {
  const { deps } = fakeDeps();
  const w = wallet();
  const prepared = await prepareStrategy(deps, base(w, { buyUsd: 0.5 }));
  assert.equal(prepared.ok, true);
  const stored = (await listStrategies(w, 1_000_000)).find((s) => s.id === (prepared.ok ? prepared.record.id : ""));
  assert.equal(stored?.kind, "buy");
});
