import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgEnqueue } from "@/lib/db/telegram";
import type { BuyTrade, FeedDeps } from "./feeds";
import { buildHistory, buyFromTransaction, eventDate, publishHistory, solPriceAt, type HistoryDeps } from "./history";
import { coin, fakeMarket, OTHER, PANDA, queued, testConfig } from "./testing";

let db: Db;
before(async () => {
  db = await newTestDb();
});

const T = (iso: string) => Date.parse(iso);
const BOT_ON = T("2026-10-10T08:00:00Z");
let run = 0;

function deps(over: Partial<HistoryDeps> = {}): HistoryDeps {
  const group = `-100${++run}`; // its own chat per test: the tests share one database
  const feed: FeedDeps = {
    db,
    now: () => T("2026-10-10T16:00:00Z"),
    cfg: testConfig({ groupId: group }),
    market: fakeMarket({ coins: { [PANDA]: coin(PANDA, { ticker: "PANDA", name: "PANDA", image: "https://img.example/panda.png" }), [OTHER]: coin(OTHER, { ticker: "OLD", name: "Old coin" }) } }),
    pandaMint: PANDA,
    feeSplit: async () => null,
    feeLockPending: async () => false,
    trades: async () => [],
    treasury: "TREASURY",
    rewardsPool: null,
  };
  return {
    ...feed,
    botSince: async () => BOT_ON,
    launches: async () => [],
    payouts: async () => [],
    buys: async () => ({ buys: [], complete: true, scanned: 0 }),
    alreadyPosted: async () => new Set(),
    ...over,
  };
}
const buy = (tx: string, at: string, usdValue: number): BuyTrade => ({ txHash: tx, wallet: "35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh", kind: "buy", usd: usdValue, sol: usdValue / 200, at: T(at) });

test("the date of an event is written as 'Oct 8, 2026 · 21:14 UTC'", () => {
  assert.equal(eventDate(T("2026-10-08T21:14:59Z")), "Oct 8, 2026 · 21:14 UTC");
  assert.equal(eventDate(T("2026-01-01T00:05:00Z")), "Jan 1, 2026 · 00:05 UTC");
});

test("everything before the bot, oldest first, in the live posts' format with the real date under the title — and nothing from after it", async () => {
  const d = deps({
    launches: async () => [
      { mint: OTHER, creator: "C1", launchedAt: T("2026-10-07T10:00:00Z") },
      { mint: PANDA, creator: "C2", launchedAt: T("2026-10-08T09:30:00Z") },
      { mint: "LATER1", creator: "C3", launchedAt: T("2026-10-10T09:00:00Z") }, // after the bot: the live feed's job
    ],
    buys: async () => ({ buys: [buy("txB", "2026-10-09T12:00:00Z", 55), buy("txA", "2026-10-08T21:14:00Z", 120), buy("txSmall", "2026-10-08T22:00:00Z", 19.99), buy("txLate", "2026-10-10T09:00:00Z", 500)], complete: true, scanned: 4 }),
    payouts: async () => [
      { mint: PANDA, holdersPaid: 10, lamportsPaid: 1e9, finishedAt: T("2026-10-09T03:00:00Z") },
      { mint: PANDA, holdersPaid: 5, lamportsPaid: 5e8, finishedAt: T("2026-10-09T18:00:00Z") },
      { mint: PANDA, holdersPaid: 0, lamportsPaid: 0, finishedAt: T("2026-10-08T03:00:00Z") },
    ],
  });
  const { items, until } = await buildHistory(d);
  assert.equal(until, BOT_ON);
  assert.deepEqual(items.map((i) => [i.topic, i.message.dedupeKey]), [
    ["newCoins", `launch:${OTHER}`],
    ["newCoins", `launch:${PANDA}`],
    ["buys", "buy:txA"],
    ["buys", "buy:txB"],
    ["payouts", "payouts-history:2026-10-09"],
  ]);
  assert.ok(items.every((i, k) => k === 0 || items[k - 1].at <= i.at), "chronological");
  const [old, panda, firstBuy, , payout] = items;
  assert.equal(old.message.method, "sendMessage");
  assert.match(String(old.message.payload.text), /^🆕 <b>New coin launched on PANDA<\/b>\n🕒 Oct 7, 2026 · 10:00 UTC\n<b>Old coin<\/b> \(\$OLD\)\n/);
  assert.equal(old.message.payload.message_thread_id, 11, "the New coins topic");
  assert.equal(panda.message.method, "sendPhoto", "with the coin's image, like the live post");
  assert.match(String(firstBuy.message.payload.text), /^🟢 <b>\$PANDA buy<\/b> · \$120(\.00)? · 0\.6 SOL\n🕒 Oct 8, 2026 · 21:14 UTC\nWallet: /);
  assert.equal(firstBuy.message.payload.message_thread_id, 12);
  assert.equal(String(payout.message.payload.text), "💸 <b>Holder payouts</b> — paid on-chain:\n🕒 Oct 9, 2026 · 18:00 UTC\n• $PANDA: 1.5 SOL to 15 holders");
  assert.equal(payout.message.payload.message_thread_id, 13);
});

test("no payouts → nothing for that topic; no group configured → nothing at all", async () => {
  const none = await buildHistory(deps({ launches: async () => [{ mint: OTHER, creator: "C", launchedAt: 1 }] }));
  assert.deepEqual(none.items.map((i) => i.topic), ["newCoins"]);
  const d = deps({ launches: async () => [{ mint: OTHER, creator: "C", launchedAt: 1 }] });
  assert.equal((await buildHistory({ ...d, cfg: testConfig({ groupId: null }) })).items.length, 0);
});

test("a dry run queues nothing; the real run queues once; what the bot already posted (same keys as the live feed) is never posted again", async () => {
  const d = deps({
    launches: async () => [{ mint: OTHER, creator: "C1", launchedAt: T("2026-10-07T10:00:00Z") }],
    buys: async () => ({ buys: [buy("txLive", "2026-10-09T10:00:00Z", 80), buy("txOld", "2026-10-08T10:00:00Z", 80)], complete: true, scanned: 2 }),
  });
  const group = d.cfg.groupId!;
  // The live feed had already posted this buy, with its own dedupe key.
  await tgEnqueue(db, { chatId: group, method: "sendMessage", dedupeKey: "buy:txLive", payload: { text: "live" } }, 1);
  const real: HistoryDeps = { ...d, alreadyPosted: async (keys) => new Set(keys.filter((k) => k === "buy:txLive")) };
  const dry = await publishHistory(real, { dryRun: true });
  assert.equal((await queued(db, group)).length, 1, "dry run: nothing new");
  assert.deepEqual([dry.topics.newCoins.queued, dry.topics.buys.queued, dry.topics.buys.alreadyPosted], [1, 1, 1]);
  assert.equal(dry.topics.buys.first, "Oct 8, 2026 · 10:00 UTC");
  const done = await publishHistory(real, { dryRun: false });
  assert.deepEqual([done.topics.newCoins.queued, done.topics.buys.queued, done.topics.buys.alreadyPosted, done.topics.payouts.found], [1, 1, 1, 0]);
  const q = await queued(db, group);
  assert.deepEqual(q.map((m) => m.row.dedupeKey), ["buy:txLive", `launch:${OTHER}`, "buy:txOld"], "queued oldest first, after what was there");
  // Even if "already posted" weren't checked first, the queue's own dedupe refuses a second copy.
  const again = await publishHistory(d, { dryRun: false });
  assert.deepEqual([again.topics.newCoins.queued, again.topics.buys.queued], [0, 0]);
  assert.equal((await queued(db, group)).length, 3);
});

test("a scan of the chain that didn't finish publishes NO buys (never a partial history) — the rest still goes", async () => {
  const d = deps({ launches: async () => [{ mint: "MINT5", creator: "C1", launchedAt: 5 }], buys: async () => ({ buys: [buy("txP", "2026-10-08T10:00:00Z", 80)], complete: false, scanned: 1 }) });
  const r = await publishHistory(d, { dryRun: false });
  assert.deepEqual([r.buysComplete, r.topics.buys.found, r.topics.buys.queued, r.topics.newCoins.queued], [false, 1, 0, 1]);
});

// ── reading a buy from the chain ────────────────────────────────────────────────────────────────────────────────────

const key = (s: string, signer: boolean) => ({ pubkey: { toBase58: () => s }, signer });
const bal = (owner: string, ui: number, mint = PANDA) => ({ mint, owner, uiTokenAmount: { uiAmount: ui } });
const txOf = (over: Record<string, unknown> = {}) => ({
  blockTime: 1_791_500_000,
  meta: { err: null, fee: 5000, preBalances: [2_000_000_000, 0], postBalances: [1_499_995_000, 0], preTokenBalances: [bal("BUYER", 0)], postTokenBalances: [bal("BUYER", 1000), bal("POOL", 5)], ...((over.meta as object) ?? {}) },
  transaction: { signatures: ["SIG1"], message: { accountKeys: [key("BUYER", true), key("POOL", false)] } },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "meta")),
});

test("a buy read from its transaction: the signer whose balance of the coin went up, the SOL that left (fee aside), valued at that hour's SOL price", () => {
  assert.deepEqual(buyFromTransaction(txOf(), PANDA, 200), { txHash: "SIG1", wallet: "BUYER", kind: "buy", usd: 100, sol: 0.5, at: 1_791_500_000_000 });
});

test("not a buy: a sell, a failed transaction, another coin, tokens received by someone who didn't sign, a buy not paid in SOL", () => {
  assert.equal(buyFromTransaction(txOf({ meta: { preTokenBalances: [bal("BUYER", 1000)], postTokenBalances: [bal("BUYER", 0)] } }), PANDA, 200), null);
  assert.equal(buyFromTransaction(txOf({ meta: { err: { InstructionError: [0, "Custom"] } } }), PANDA, 200), null);
  assert.equal(buyFromTransaction(txOf({ meta: { preTokenBalances: [], postTokenBalances: [bal("BUYER", 1000, OTHER)] } }), PANDA, 200), null);
  assert.equal(buyFromTransaction(txOf({ meta: { preTokenBalances: [], postTokenBalances: [bal("POOL", 1000)] } }), PANDA, 200), null);
  assert.equal(buyFromTransaction(txOf({ meta: { preBalances: [1000, 0], postBalances: [1000, 0] } }), PANDA, 200), null);
  assert.equal(buyFromTransaction(null, PANDA, 200), null);
  assert.equal(buyFromTransaction(txOf({ blockTime: null }), PANDA, 200), null);
});

test("the SOL price of that hour: the candle the moment falls in, else the nearest; none → 0", () => {
  const candles = [{ time: 3600, close: 100 }, { time: 7200, close: 110 }, { time: 10800, close: 120 }];
  assert.equal(solPriceAt(candles, 7300_000), 110);
  assert.equal(solPriceAt(candles, 10_000), 100, "before the first");
  assert.equal(solPriceAt(candles, 99_999_000), 120, "after the last");
  assert.equal(solPriceAt([], 1), 0);
});
