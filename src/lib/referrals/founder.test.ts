import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgAddTrades } from "@/lib/db/trades";
import { pgBindReferral, pgFounderAllocation, pgIsFounder, pgReserveFounderSlot } from "@/lib/db/referrals";
import { recordFounderProgress } from "./founder";

const SAVED = { ...process.env };
let db: Db;
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => {
  setDbForTests(null);
  process.env = SAVED;
});
beforeEach(() => {
  process.env.FEATURE_FOUNDER_NFT = "true";
  // A couple of tests below override these — reset so they can never leak into a later one by file order.
  delete process.env.FOUNDER_REQUIRED_TRADERS;
  delete process.env.FOUNDER_MIN_TRADER_VOLUME_USD;
});

const addr = () => Keypair.generate().publicKey.toBase58();
let seq = 0;

/** Logs one trade worth exactly `usd` (solPriceUsdAtTrade=1 keeps the math trivial), already in the DB — the
 *  way src/app/api/portfolio/record-trade's route really calls recordTrade() BEFORE recordFounderProgress(). */
async function seedTradeUsd(wallet: string, usd: number) {
  await pgAddTrades(db, wallet, [
    {
      mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ticker: "X",
      side: "buy",
      solAmount: usd,
      tokenAmount: 1,
      solPriceUsdAtTrade: 1,
      signature: `SIG-${wallet}-${++seq}`,
      ts: 1000,
    },
  ]);
}

/** Brings `wallet` (bound to `referrer`) from `priorUsd` to `priorUsd + thisTradeUsd` of cumulative volume, then
 *  calls recordFounderProgress exactly the way the real trade route does. */
async function tradeAndRecord(wallet: string, referrer: string | null, priorUsd: number, thisTradeUsd: number) {
  if (referrer) await pgBindReferral(db, wallet, referrer, 1000);
  if (priorUsd > 0) await seedTradeUsd(wallet, priorUsd);
  await seedTradeUsd(wallet, thisTradeUsd);
  await recordFounderProgress(wallet, thisTradeUsd);
}

test("recordFounderProgress: a trade that doesn't cross the volume threshold does nothing, even for the 10th invitee", async () => {
  process.env.FOUNDER_REQUIRED_TRADERS = "1";
  process.env.FOUNDER_MIN_TRADER_VOLUME_USD = "100";
  const referrer = addr();
  await tradeAndRecord(addr(), referrer, 0, 40); // well under $100
  assert.equal(await pgIsFounder(db, referrer), false);
});

test("recordFounderProgress: crossing the threshold for the LAST required invitee reserves the referrer a Founder slot", async () => {
  process.env.FOUNDER_REQUIRED_TRADERS = "2";
  process.env.FOUNDER_MIN_TRADER_VOLUME_USD = "100";
  const referrer = addr();
  await tradeAndRecord(addr(), referrer, 0, 150); // 1st valid invitee
  assert.equal(await pgIsFounder(db, referrer), false, "only 1 of 2 required so far");
  await tradeAndRecord(addr(), referrer, 0, 150); // 2nd valid invitee — crosses the requirement
  assert.equal(await pgIsFounder(db, referrer), true);
});

test("recordFounderProgress: a SECOND trade that crosses the threshold (volume built up over multiple trades) still counts", async () => {
  process.env.FOUNDER_REQUIRED_TRADERS = "1";
  process.env.FOUNDER_MIN_TRADER_VOLUME_USD = "100";
  const referrer = addr();
  const invitee = addr();
  await pgBindReferral(db, invitee, referrer, 1000);
  await tradeAndRecord(invitee, null, 0, 60); // first trade: 60, not enough
  assert.equal(await pgIsFounder(db, referrer), false);
  // a second, separate trade (not re-bound) pushes the SAME invitee over the line
  await seedTradeUsd(invitee, 41); // total now 101
  await recordFounderProgress(invitee, 41);
  assert.equal(await pgIsFounder(db, referrer), true);
});

test("recordFounderProgress: a wallet with no referrer never reserves anything, and never throws", async () => {
  process.env.FOUNDER_MIN_TRADER_VOLUME_USD = "100";
  await tradeAndRecord(addr(), null, 0, 500); // no referrer at all
  // nothing to assert a negative on besides "it didn't throw" — covered by the test completing.
});

test("recordFounderProgress: an already-Founder referrer is never recounted or re-reserved", async () => {
  process.env.FOUNDER_REQUIRED_TRADERS = "1";
  process.env.FOUNDER_MIN_TRADER_VOLUME_USD = "100";
  const referrer = addr();
  await pgReserveFounderSlot(db, referrer, 1000); // already a Founder via some other path
  const before = await pgFounderAllocation(db, referrer);
  await tradeAndRecord(addr(), referrer, 0, 500);
  assert.deepEqual(await pgFounderAllocation(db, referrer), before, "unchanged — same rank, same reservedAt");
});

test("recordFounderProgress: FEATURE_FOUNDER_NFT off does nothing, even well past every threshold", async () => {
  process.env.FEATURE_FOUNDER_NFT = "false";
  process.env.FOUNDER_REQUIRED_TRADERS = "1";
  process.env.FOUNDER_MIN_TRADER_VOLUME_USD = "1";
  const referrer = addr();
  await tradeAndRecord(addr(), referrer, 0, 1000);
  assert.equal(await pgIsFounder(db, referrer), false);
});

test("recordFounderProgress: order of arrival — the first referrer to cross the requirement gets rank 1", async () => {
  process.env.FOUNDER_REQUIRED_TRADERS = "1";
  process.env.FOUNDER_MIN_TRADER_VOLUME_USD = "100";
  const first = addr();
  const second = addr();
  await tradeAndRecord(addr(), first, 0, 150);
  await tradeAndRecord(addr(), second, 0, 150);
  const a = await pgFounderAllocation(db, first);
  const b = await pgFounderAllocation(db, second);
  assert.ok(a && b && a.rank < b.rank, "first to cross the line ranks ahead");
});

test("recordFounderProgress: a trade of zero or negative USD is a no-op, never throws", async () => {
  const referrer = addr();
  const invitee = addr();
  await pgBindReferral(db, invitee, referrer, 1000);
  await recordFounderProgress(invitee, 0);
  await recordFounderProgress(invitee, -5);
  assert.equal(await pgIsFounder(db, referrer), false);
});
