import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "./client";
import { newTestDb } from "./testing";
import { pgAddTrades, pgGetBackfillMark, pgGetTrades, pgSetBackfillMark } from "./trades";
import { pgAddMetrics, pgReadDays, pgReadJournal, pgReadTotal, pgRecordActivity } from "./activity";
import { pgGetPauseState, pgSetPause } from "./pause";
import { emptyMetrics } from "@/lib/economy/rollup";
import type { StoredEvent } from "@/lib/activity/types";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";

let db: Db;
before(async () => {
  db = await newTestDb();
});

const W = "W".repeat(44);
const trade = (i: number, extra: Partial<LoggedTrade> = {}): LoggedTrade => ({
  mint: "M".repeat(43), ticker: "TCK", side: i % 2 ? "sell" : "buy", solAmount: 0.1 + i / 1000, tokenAmount: 1234.5678 * (i + 1),
  solPriceUsdAtTrade: 142.123456789, signature: `sig-${i}`, ts: 1_750_000_000_000 + i, ...extra,
});

// ── trades ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("trades come back exactly as they went in (floats included), in insertion order", async () => {
  const wallet = "T1" + W;
  const list = [trade(3), trade(1, { estimated: true }), trade(2)];
  assert.equal(await pgAddTrades(db, wallet, list), 3);
  assert.deepEqual(await pgGetTrades(db, wallet), list);
});

test("recording the same trade twice is a no-op, per wallet", async () => {
  const a = "T2" + W, b = "T3" + W;
  assert.equal(await pgAddTrades(db, a, [trade(1)]), 1);
  assert.equal(await pgAddTrades(db, a, [trade(1), trade(2)]), 1, "only the new one counted");
  assert.equal(await pgAddTrades(db, b, [trade(1)]), 1, "another wallet may log the same signature");
  assert.equal((await pgGetTrades(db, a)).length, 2);
});

test("a wallet with no trades has an empty log; the scan marker round-trips and updates", async () => {
  const wallet = "T4" + W;
  assert.deepEqual(await pgGetTrades(db, wallet), []);
  assert.equal(await pgGetBackfillMark(db, wallet), null);
  await pgSetBackfillMark(db, wallet, 111);
  await pgSetBackfillMark(db, wallet, 222);
  assert.deepEqual(await pgGetBackfillMark(db, wallet), { at: 222 });
});

test("the database refuses a trade whose side isn't buy/sell", async () => {
  await assert.rejects(pgAddTrades(db, "T5" + W, [trade(1, { side: "hold" as unknown as "buy" })]));
});

// ── activity + economy ────────────────────────────────────────────────────────────────────────────────────────────────
const NOW = Date.UTC(2031, 5, 10, 12, 0, 0);
const ev = (id: string, extra: Partial<StoredEvent> = {}): StoredEvent => ({ id, kind: "buy", ts: NOW - 1000, mint: "M".repeat(43), verified: true, ...extra });
const CAP = 5;

test("a new event is stored and adds its numbers to the day and all-time totals in one go", async () => {
  const before = await pgReadTotal(db);
  const r = await pgRecordActivity(db, ev("trade:a1", { wallet: W, lamports: 1000, signature: "S".repeat(88) }), { volumeLamports: 1000, trades: 1, tradeFeeLamports: 10 }, NOW, CAP);
  assert.equal(r, "added");
  const total = await pgReadTotal(db);
  assert.equal(total.metrics.volumeLamports - before.metrics.volumeLamports, 1000);
  assert.equal(total.metrics.trades - before.metrics.trades, 1);
  const day = (await pgReadDays(db, NOW, 1))[0];
  assert.equal(day.day, "2031-06-10");
  assert.equal(day.metrics.tradeFeeLamports, 10);
  assert.ok(total.since !== null && total.since <= NOW - 1000);
});

test("IDEMPOTENT: the same event twice is stored once and counted once", async () => {
  const base = (await pgReadTotal(db)).metrics.trades;
  assert.equal(await pgRecordActivity(db, ev("trade:dup"), { trades: 1 }, NOW, CAP), "added");
  assert.equal(await pgRecordActivity(db, ev("trade:dup"), { trades: 1 }, NOW, CAP), "duplicate");
  assert.equal((await pgReadTotal(db)).metrics.trades - base, 1);
  assert.equal((await pgReadJournal(db, NOW, 1)).filter((e) => e.id === "trade:dup").length, 1);
});

test("ATOMIC: if adding the numbers fails, the event is not stored either (Blob could undercount here)", async () => {
  const own = await newTestDb(); // its own database: the totals are pushed to the edge of what a JS number can hold
  const near = Number.MAX_SAFE_INTEGER - 5;
  assert.equal(await pgRecordActivity(own, ev("big:1"), { volumeLamports: near }, NOW, CAP), "added");
  await assert.rejects(pgRecordActivity(own, ev("big:2"), { volumeLamports: 10 }, NOW, CAP), /overflow/i);
  assert.equal((await pgReadJournal(own, NOW, 1)).some((e) => e.id === "big:2"), false, "the event was rolled back with its numbers");
  assert.equal((await pgReadTotal(own)).metrics.volumeLamports, near, "and the totals are untouched");
  assert.equal(await pgRecordActivity(own, ev("big:2"), { volumeLamports: 3 }, NOW, CAP), "added", "it can be recorded properly afterwards");
});

test("malformed metrics are refused before anything is written", async () => {
  await assert.rejects(pgRecordActivity(db, ev("trade:bad"), { trades: -1 }, NOW, CAP), /malformed/i);
  await assert.rejects(pgRecordActivity(db, ev("trade:bad2"), { nope: 1 } as never, NOW, CAP), /malformed/i);
  assert.equal((await pgReadJournal(db, NOW, 1)).some((e) => e.id.startsWith("trade:bad")), false);
});

test("a full day stores nothing more and counts the rest as dropped; a repeat of a stored event is still a duplicate", async () => {
  const day = Date.UTC(2032, 0, 5, 9, 0, 0);
  for (let i = 0; i < CAP; i++) assert.equal(await pgRecordActivity(db, ev(`cap:${i}`, { ts: day }), { trades: 1 }, day, CAP), "added");
  assert.equal(await pgRecordActivity(db, ev("cap:over", { ts: day }), { trades: 1 }, day, CAP), "full");
  assert.equal(await pgRecordActivity(db, ev("cap:0", { ts: day }), { trades: 1 }, day, CAP), "duplicate");
  const d = (await pgReadDays(db, day, 1))[0].metrics;
  assert.equal(d.trades, CAP, "the over-cap event's trade was NOT counted");
  assert.equal(d.dropped, 1);
  assert.equal((await pgReadJournal(db, day, 1)).filter((e) => e.id.startsWith("cap:")).length, CAP);
});

test("the journal window is the last N write-days, and readDays zero-fills days with nothing", async () => {
  const t0 = Date.UTC(2033, 2, 1, 10, 0, 0);
  await pgRecordActivity(db, ev("win:old", { ts: t0 }), undefined, t0, 100);
  await pgRecordActivity(db, ev("win:new", { ts: t0 + 3 * 86_400_000 }), undefined, t0 + 3 * 86_400_000, 100);
  const ids = (await pgReadJournal(db, t0 + 3 * 86_400_000, 2)).map((e) => e.id);
  assert.ok(ids.includes("win:new") && !ids.includes("win:old"), "2 days back from day 3 does not reach day 0");
  const days = await pgReadDays(db, t0 + 3 * 86_400_000, 4);
  assert.deepEqual(days.map((d) => d.day), ["2033-03-01", "2033-03-02", "2033-03-03", "2033-03-04"], "oldest first");
  assert.deepEqual(days[1].metrics, emptyMetrics());
});

test("addMetrics adds directly, validates, and keeps the earliest 'since'", async () => {
  const t = Date.UTC(2020, 0, 1);
  assert.equal(await pgAddMetrics(db, t, { distributions: 2 }), true);
  assert.equal((await pgReadTotal(db)).since, t);
  assert.equal(await pgAddMetrics(db, -5, { distributions: 1 }), false);
  assert.equal(await pgAddMetrics(db, t, { distributions: -1 }), false);
});

// ── pause ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("pause: empty at first; pausing and resuming report what changed; repeating the same state changes nothing", async () => {
  assert.deepEqual(await pgGetPauseState(db), { version: 1, subsystems: {} });
  const p = await pgSetPause(db, "claims", true, "  investigating  ", "ADMIN", 1000);
  assert.equal(p.changed, true);
  assert.equal(p.before, null);
  assert.deepEqual(p.after, { paused: true, reason: "investigating", since: 1000, by: "ADMIN" });
  const again = await pgSetPause(db, "claims", true, "again", "OTHER", 2000);
  assert.equal(again.changed, false);
  assert.equal((await pgGetPauseState(db)).subsystems.claims?.by, "ADMIN", "an unchanged request rewrites nothing");
  const resumed = await pgSetPause(db, "claims", false, "", "ADMIN", 3000);
  assert.equal(resumed.changed, true);
  assert.equal(resumed.before?.paused, true);
  assert.equal((await pgGetPauseState(db)).subsystems.claims?.paused, false);
});

test("pause: simultaneous pauses of one subsystem end in a consistent single row", async () => {
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => pgSetPause(db, "fee_processing", true, "why " + i, "A" + i, 5000 + i)));
  assert.equal(results.filter((r) => r.changed).length, 1, "exactly one request actually changed it");
  assert.equal((await pgGetPauseState(db)).subsystems.fee_processing?.paused, true);
});
