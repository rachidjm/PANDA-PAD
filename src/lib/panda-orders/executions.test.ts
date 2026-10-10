import { test } from "node:test";
import assert from "node:assert/strict";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import { FRESH_PRICE_MS, logExecutions, MAX_PER_CALL, type ExecutedOrder, type ExecutionDeps, type TxFacts } from "./executions";

const NOW = 1_800_000_000_000;
const order = (over: Partial<ExecutedOrder> = {}): ExecutedOrder => ({ wallet: "W1", mint: "TM", ticker: "TM", signature: "sig1", state: "executed", executedAt: NOW - 60_000, ...over });

function deps(facts: Record<string, TxFacts | null>, over: Partial<ExecutionDeps> = {}) {
  const log = new Map<string, LoggedTrade[]>();
  const reads: string[] = [];
  const d: ExecutionDeps = {
    now: () => NOW,
    getTrades: async (w) => log.get(w) ?? [],
    recordTrade: async (w, t) => void log.set(w, [...(log.get(w) ?? []), t]),
    txFacts: async (sig) => (reads.push(sig), facts[sig] ?? null),
    solUsd: async () => 200,
    ...over,
  };
  return { d, log, reads };
}

test("an executed order is logged as a real sell: what the chain says it paid, the tokens that left, at the block's time", async () => {
  const blockTimeMs = NOW - 90_000;
  const { d, log } = deps({ sig1: { solAmount: 0.5, tokenAmount: 120_000, blockTimeMs } });
  assert.equal(await logExecutions(d, [order()]), 1);
  assert.deepEqual(log.get("W1"), [{ mint: "TM", ticker: "TM", side: "sell", solAmount: 0.5, tokenAmount: 120_000, solPriceUsdAtTrade: 200, signature: "sig1", ts: blockTimeMs }]);
  // Real price per token = 0.5 SOL × $200 / 120,000 — from the transaction, not from the price the user drew.
  const t = log.get("W1")![0];
  assert.equal((t.solAmount * t.solPriceUsdAtTrade) / t.tokenAmount, 100 / 120_000);
});

test("it is logged once: asking again (the page reloads, the cron runs) adds nothing and doesn't even read the chain", async () => {
  const { d, log, reads } = deps({ sig1: { solAmount: 1, tokenAmount: 10, blockTimeMs: NOW } });
  await logExecutions(d, [order()]);
  assert.equal(await logExecutions(d, [order()]), 0);
  assert.equal(log.get("W1")!.length, 1);
  assert.equal(reads.length, 1);
});

test("only executed orders with a signature; a transaction that can't be read yet is simply tried again later", async () => {
  const { d, log } = deps({ sig2: null });
  const n = await logExecutions(d, [order({ state: "active" }), order({ state: "cancelled" }), order({ signature: null }), order({ signature: "sig2" })]);
  assert.equal(n, 0);
  assert.equal(log.size, 0);
});

test("an old execution logged late is marked as an estimate (the SOL price is today's); without any SOL price nothing is logged", async () => {
  const old = NOW - FRESH_PRICE_MS - 1;
  const { d, log } = deps({ sig1: { solAmount: 1, tokenAmount: 10, blockTimeMs: old } });
  await logExecutions(d, [order()]);
  assert.equal(log.get("W1")![0].estimated, true);
  const none = deps({ sig1: { solAmount: 1, tokenAmount: 10, blockTimeMs: NOW } }, { solUsd: async () => 0 });
  assert.equal(await logExecutions(none.d, [order()]), 0);
  assert.equal(none.log.size, 0);
});

test("no block time → the moment PANDA saw it execute; several wallets each get their own; a few per call at most", async () => {
  const facts: Record<string, TxFacts> = {};
  const orders: ExecutedOrder[] = [];
  for (let k = 0; k < MAX_PER_CALL + 3; k++) {
    facts[`s${k}`] = { solAmount: 1, tokenAmount: 10, blockTimeMs: null };
    orders.push(order({ signature: `s${k}`, wallet: k % 2 ? "W1" : "W2", executedAt: NOW - k }));
  }
  const { d, log } = deps(facts);
  assert.equal(await logExecutions(d, orders), MAX_PER_CALL);
  assert.equal((log.get("W1")?.length ?? 0) + (log.get("W2")?.length ?? 0), MAX_PER_CALL);
  assert.equal(log.get("W2")![0].ts, NOW);
  assert.equal(await logExecutions(d, orders), 3, "the rest on the next call");
});
