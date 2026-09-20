import { test } from "node:test";
import assert from "node:assert/strict";
import { computePositions, Position } from "./positions";
import { allocation, buildRows, NATIVE_MINT, summarize, sumRewards, TokenRow } from "./view";
import type { LoggedTrade } from "./trade-log";
import type { PortfolioHolding } from "@/lib/types";

const trade = (over: Partial<LoggedTrade>): LoggedTrade => ({
  mint: "MintA",
  ticker: "AAA",
  side: "buy",
  solAmount: 1,
  tokenAmount: 1000,
  solPriceUsdAtTrade: 100,
  signature: Math.random().toString(36),
  ts: 1,
  ...over,
});
const holding = (over: Partial<PortfolioHolding>): PortfolioHolding => ({ mint: "MintA", amount: 1000, decimals: 6, symbol: "AAA", priceUsd: 0.2, valueUsd: 200, ...over });
const pos = (over: Partial<Position>): Position => ({
  mint: "MintA", ticker: "AAA", remainingTokens: 1000, avgCostUsd: 0.1, pnlUsd: 0, pnlPct: 0, priceKnown: true, realizedPnlUsd: 0, partialHistory: false, lastTradeTs: 1, ...over,
});

// ---- positions: what is known vs unknown ------------------------------------------------------

test("an open position with no live price says so instead of reporting a flat 0", () => {
  const { open } = computePositions([trade({})], {}, {});
  assert.equal(open[0].priceKnown, false);
  const priced = computePositions([trade({})], { minta: 0.2 }, {});
  assert.equal(priced.open[0].priceKnown, true);
  assert.ok(Math.abs(priced.open[0].pnlUsd - 100) < 1e-9, "1000 tokens bought at $0.10, now $0.20");
});

test("realized profit is tracked per coin, and sells of tokens we never saw bought mark the history as partial", () => {
  const trades = [
    trade({ side: "buy", solAmount: 1, tokenAmount: 1000, ts: 1 }),
    trade({ side: "sell", solAmount: 1.5, tokenAmount: 500, ts: 2 }), // sold half for $150, cost basis $50
  ];
  const { open } = computePositions(trades, { minta: 0.1 }, {});
  assert.equal(open[0].remainingTokens, 500);
  assert.ok(Math.abs(open[0].realizedPnlUsd - 100) < 1e-9);
  assert.equal(open[0].partialHistory, false);

  const orphan = computePositions([trade({ side: "sell", solAmount: 2, tokenAmount: 300, ts: 1 }), trade({ side: "buy", ts: 2 })], { minta: 0.1 }, {});
  assert.equal(orphan.open[0].partialHistory, true, "a sell with no known purchase behind it");
});

// ---- rows: the three honesty levels -------------------------------------------------------------

test("TRACKED: PANDA-recorded trades that cover the whole balance", () => {
  const [row] = buildRows([holding({})], [pos({})]);
  assert.equal(row.pnl.kind, "tracked");
  if (row.pnl.kind === "tracked") {
    assert.ok(Math.abs(row.pnl.usd - 100) < 1e-9);
    assert.ok(Math.abs(row.pnl.pct - 100) < 1e-9);
  }
  assert.equal(row.avgEntryUsd, 0.1);
});

test("ESTIMATED: history read back from the chain, partial history, or a balance that doesn't match the log", () => {
  assert.equal(buildRows([holding({})], [pos({ estimated: true })])[0].pnl.kind, "estimated");
  assert.equal(buildRows([holding({})], [pos({ partialHistory: true })])[0].pnl.kind, "estimated");
  assert.equal(buildRows([holding({ amount: 400 })], [pos({ remainingTokens: 1000 })])[0].pnl.kind, "estimated", "sold or moved elsewhere");
  assert.equal(buildRows([holding({ amount: 2500 })], [pos({ remainingTokens: 1000 })])[0].pnl.kind, "estimated", "bought elsewhere");
  assert.equal(buildRows([holding({ amount: 990 })], [pos({ remainingTokens: 1000 })])[0].pnl.kind, "tracked", "rounding-level difference is fine");
});

test("UNAVAILABLE: never a number without a known cost or a live price; SOL isn't tracked at all", () => {
  const noTrades = buildRows([holding({})], [])[0];
  assert.deepEqual(noTrades.pnl, { kind: "unavailable", reason: "no_trades" });
  assert.equal(noTrades.avgEntryUsd, null);
  const noPrice = buildRows([holding({ priceUsd: undefined, valueUsd: undefined })], [pos({})])[0];
  assert.deepEqual(noPrice.pnl, { kind: "unavailable", reason: "no_price" });
  assert.equal(noPrice.avgEntryUsd, 0.1, "the entry is still known");
  const zeroCost = buildRows([holding({})], [pos({ avgCostUsd: 0 })])[0];
  assert.equal(zeroCost.pnl.kind, "unavailable");
  const sol = buildRows([holding({ mint: NATIVE_MINT, symbol: "SOL" })], [pos({ mint: NATIVE_MINT })])[0];
  assert.deepEqual(sol.pnl, { kind: "unavailable", reason: "not_tracked" });
});

// ---- summary -----------------------------------------------------------------------------------------

test("summary: value only from priced holdings, and it says how many weren't", () => {
  const rows = buildRows([holding({}), holding({ mint: "MintB", priceUsd: undefined, valueUsd: undefined })], [pos({})]);
  const s = summarize(rows, [pos({})]);
  assert.equal(s.valueUsd, 200);
  assert.deepEqual([s.pricedCount, s.unpricedCount], [1, 1]);
  assert.equal(summarize(buildRows([holding({ priceUsd: undefined, valueUsd: undefined })], []), []).valueUsd, null, "nothing priced -> no total, not $0");
});

test("summary: unrealized P&L covers only what has a cost and a price, and is 'estimated' as soon as anything is left out or approximate", () => {
  const rows = buildRows([holding({}), holding({ mint: "MintB", amount: 10, priceUsd: 1, valueUsd: 10 })], [pos({})]);
  const s = summarize(rows, [pos({})]);
  assert.equal(s.unrealized?.coveredCount, 1);
  assert.equal(s.unrealized?.excludedCount, 1, "MintB has no known cost");
  assert.equal(s.unrealized?.kind, "estimated");
  assert.ok(Math.abs((s.unrealized?.usd ?? 0) - 100) < 1e-9);
  assert.ok(Math.abs((s.unrealized?.pct ?? 0) - 100) < 1e-9);

  const clean = summarize(buildRows([holding({})], [pos({})]), [pos({})]);
  assert.equal(clean.unrealized?.kind, "tracked");
  assert.equal(clean.unrealized?.excludedCount, 0);

  const solOnly = summarize(buildRows([holding({ mint: NATIVE_MINT })], []), []);
  assert.equal(solOnly.unrealized, null, "SOL alone has no P&L to show");
  assert.equal(solOnly.realized, null);
});

test("summary: realized P&L adds up every coin and is estimated when any of it is", () => {
  const closed = pos({ remainingTokens: 0, realizedPnlUsd: -20, pnlUsd: -20 });
  const partial = pos({ mint: "MintB", realizedPnlUsd: 70, partialHistory: true });
  const clean = summarize([], [closed, pos({ mint: "MintC", realizedPnlUsd: 30 })]);
  assert.deepEqual(clean.realized, { usd: 10, kind: "tracked" });
  assert.deepEqual(summarize([], [closed, partial]).realized, { usd: 50, kind: "estimated" });
  assert.deepEqual(summarize([], [closed, pos({ mint: "MintD", realizedPnlUsd: 5, estimated: true })]).realized, { usd: -15, kind: "estimated" });
  assert.equal(summarize([], [pos({})]).realized, null, "an open position that never sold has nothing realized");
});

// ---- allocation ----------------------------------------------------------------------------------------

const rowOf = (mint: string, valueUsd?: number): TokenRow => ({ mint, symbol: mint, amount: 1, valueUsd, avgEntryUsd: null, pnl: { kind: "unavailable", reason: "no_trades" } });

test("allocation: biggest first, the rest grouped as other, always exactly 10 000 bps", () => {
  const rows = ["A", "B", "C", "D", "E", "F", "G"].map((m, i) => rowOf(m, (i + 1) * 10));
  const a = allocation(rows, 3);
  assert.deepEqual(a.map((s) => s.key), ["G", "F", "E", "other"]);
  assert.equal(a.find((s) => s.other)?.valueUsd, 10 + 20 + 30 + 40);
  assert.equal(a.reduce((s, x) => s + x.bps, 0), 10_000);
  assert.deepEqual(allocation([rowOf("A", 100)]), [{ key: "A", label: "$A", valueUsd: 100, bps: 10_000 }]);
  assert.deepEqual(allocation([rowOf("A"), rowOf("B", 0)]), [], "nothing priced");
});

test("FUZZ allocation: integer bps, non-negative, sorted, always sum to 10 000", () => {
  let seed = 5;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let run = 0; run < 400; run++) {
    const n = 1 + Math.floor(rnd() * 12);
    const rows = Array.from({ length: n }, (_, i) => rowOf(`M${i}`, rnd() < 0.15 ? undefined : Math.exp(rnd() * 12)));
    const a = allocation(rows, 1 + Math.floor(rnd() * 6));
    if (a.length === 0) continue;
    assert.equal(a.reduce((s, x) => s + x.bps, 0), 10_000);
    for (const s of a) assert.ok(Number.isInteger(s.bps) && s.bps >= 0);
    const named = a.filter((s) => !s.other);
    for (let i = 1; i < named.length; i++) assert.ok(named[i - 1].valueUsd >= named[i].valueUsd);
  }
});

// ---- rewards ---------------------------------------------------------------------------------------------

test("rewards: sums one wallet across coins in exact lamports; unknown wallets and prototype keys give nothing", () => {
  const ledgers: Parameters<typeof sumRewards>[0] = [
    { holders: { W: { entitledLamports: 500, claimedLamports: 200 }, X: { entitledLamports: 9, claimedLamports: 0 } } },
    { holders: { W: { entitledLamports: 300, claimedLamports: 300 } } },
    { holders: { X: { entitledLamports: 1, claimedLamports: 0 } } },
  ];
  assert.deepEqual(sumRewards(ledgers, "W"), { earnedLamports: 800, claimedLamports: 500, claimableLamports: 300, coins: 2 });
  assert.deepEqual(sumRewards(ledgers, "Nobody"), { earnedLamports: 0, claimedLamports: 0, claimableLamports: 0, coins: 0 });
  assert.equal(sumRewards(ledgers, "constructor").coins, 0);
  assert.equal(sumRewards(ledgers, "__proto__").coins, 0);
});
