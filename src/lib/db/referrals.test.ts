import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "./client";
import { setDbForTests } from "./client";
import { newTestDb } from "./testing";
import {
  pgAllFounderAllocations,
  pgBindReferral,
  pgCountValidInvitees,
  pgFounderSlotsTaken,
  pgGetPandaLaunch,
  pgGetPandaLaunchesForMints,
  pgGetReferrer,
  pgInviteeVolumesUsd,
  pgRecordPandaLaunch,
  pgRecordReferralPayout,
  pgReferralStats,
  pgReleaseFounderSlot,
  pgReserveFounderSlot,
} from "./referrals";
import { pgAddTrades } from "./trades";

let db: Db;
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => setDbForTests(null));

let n = 0;
const wallet = () => `WALLET${++n}`.padEnd(40, "x");
const addr = () => Keypair.generate().publicKey.toBase58();

test("pgBindReferral: first-touch wins — a second bind of the same wallet changes nothing, even to a different referrer", async () => {
  const referred = wallet();
  const first = wallet();
  const second = wallet();
  assert.equal(await pgBindReferral(db, referred, first, 1000), true);
  assert.equal(await pgBindReferral(db, referred, second, 2000), false, "already bound — this call does nothing");
  assert.equal(await pgGetReferrer(db, referred), first);
});

test("pgGetReferrer: null for a wallet nobody referred", async () => {
  assert.equal(await pgGetReferrer(db, wallet()), null);
});

test("referrals_no_self: the database itself refuses a wallet referring itself", async () => {
  const w = wallet();
  await assert.rejects(() => pgBindReferral(db, w, w, 1000));
});

test("pgRecordReferralPayout: one row per (signature, referrer) — recording the same payout twice is a no-op", async () => {
  const referrer = wallet();
  const referred = wallet();
  const row = { signature: "SIG1", referrer, referred, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 1500, ts: 1000 };
  assert.equal(await pgRecordReferralPayout(db, row), true);
  assert.equal(await pgRecordReferralPayout(db, row), false);
  assert.equal((await pgReferralStats(db, referrer)).earnedLamports, 1500);
});

test("pgReferralStats: counts referred wallets and sums only THIS referrer's verified payouts", async () => {
  const referrer = wallet();
  const other = wallet();
  await pgBindReferral(db, wallet(), referrer, 1000);
  await pgBindReferral(db, wallet(), referrer, 1000);
  await pgBindReferral(db, wallet(), other, 1000);
  await pgRecordReferralPayout(db, { signature: "S1", referrer, referred: wallet(), mint: "M1".padEnd(40, "x"), lamports: 100, ts: 1 });
  await pgRecordReferralPayout(db, { signature: "S2", referrer, referred: wallet(), mint: "M1".padEnd(40, "x"), lamports: 250, ts: 2 });
  await pgRecordReferralPayout(db, { signature: "S3", referrer: other, referred: wallet(), mint: "M1".padEnd(40, "x"), lamports: 999, ts: 3 });
  assert.deepEqual(await pgReferralStats(db, referrer), { referredCount: 2, earnedLamports: 350 });
});

test("pgReferralStats: zero, not null/undefined, for a referrer with nobody and nothing", async () => {
  assert.deepEqual(await pgReferralStats(db, wallet()), { referredCount: 0, earnedLamports: 0 });
});

// ── Coins launched through PANDA's own Create flow ──────────────────────────────────────────────────────────────

test("pgRecordPandaLaunch: records once, is idempotent on a repeat call, and is readable back", async () => {
  const mint = addr();
  const creator = addr();
  assert.equal(await pgRecordPandaLaunch(db, mint, creator, 1000), true);
  assert.equal(await pgRecordPandaLaunch(db, mint, creator, 2000), false, "already recorded — the second call changes nothing");
  const row = await pgGetPandaLaunch(db, mint);
  assert.deepEqual(row, { creator, launchedAt: 1000 });
});

test("pgGetPandaLaunch: null for a mint never launched through PANDA", async () => {
  assert.equal(await pgGetPandaLaunch(db, addr()), null);
});

test("pgGetPandaLaunchesForMints: one bulk lookup, only returns the mints that were actually PANDA launches", async () => {
  const launched = addr();
  const organic = addr();
  const creator = addr();
  await pgRecordPandaLaunch(db, launched, creator, 5000);
  const result = await pgGetPandaLaunchesForMints(db, [launched, organic]);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get(launched), { creator, launchedAt: 5000 });
  assert.equal(result.has(organic), false);
});

test("pgGetPandaLaunchesForMints: empty input never queries, returns an empty map", async () => {
  assert.deepEqual(await pgGetPandaLaunchesForMints(db, []), new Map());
});

// ── Founder slots ─────────────────────────────────────────────────────────────────────────────────────────────────

test("pgReserveFounderSlot: ranks are sequential starting at 1, and a wallet that already has one never gets a second", async () => {
  const a = addr();
  const b = addr();
  assert.equal(await pgReserveFounderSlot(db, a, 1000), 1);
  assert.equal(await pgReserveFounderSlot(db, b, 2000), 2);
  assert.equal(await pgReserveFounderSlot(db, a, 3000), null, "a already has a slot");
  assert.equal(await pgFounderSlotsTaken(db), 2);
});

test("pgReserveFounderSlot: refuses once maxSlots is reached", async () => {
  const x = addr();
  const y = addr();
  const before = await pgFounderSlotsTaken(db);
  await pgReserveFounderSlot(db, x, 1000, before + 1);
  assert.equal(await pgReserveFounderSlot(db, y, 2000, before + 1), null, "the cap was already reached by `x`");
});

test("pgReleaseFounderSlot: deletes the row, returns whether one actually existed", async () => {
  const w = addr();
  assert.equal(await pgReleaseFounderSlot(db, w), false, "nothing to release yet");
  await pgReserveFounderSlot(db, w, 1000);
  assert.equal(await pgReleaseFounderSlot(db, w), true);
  assert.equal(await pgReleaseFounderSlot(db, w), false, "already released — not released twice");
});

test("pgAllFounderAllocations: lists every row, minted or not", async () => {
  const before = (await pgAllFounderAllocations(db)).length;
  await pgReserveFounderSlot(db, addr(), 1000);
  await pgReserveFounderSlot(db, addr(), 2000);
  assert.equal((await pgAllFounderAllocations(db)).length, before + 2);
});

// ── Founder-slot volume (valid invitees) ────────────────────────────────────────────────────────────────────────

/** Logs one trade whose SOL-amount × price equals exactly `usd`, so volume math in these tests is exact. */
async function seedTradeUsd(w: string, usd: number, seq = 0) {
  await pgAddTrades(db, w, [
    {
      mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      ticker: "X",
      side: "buy",
      solAmount: usd,
      tokenAmount: 1,
      solPriceUsdAtTrade: 1, // 1 USD per SOL keeps the math trivial: solAmount IS the USD value
      signature: `SIG-${w}-${seq}-${Math.random()}`,
      ts: 1000,
    },
  ]);
}

test("pgCountValidInvitees: only counts invitees whose OWN cumulative volume reached the threshold", async () => {
  const referrer = addr();
  const over = wallet();
  const under = wallet();
  const never = wallet();
  await pgBindReferral(db, over, referrer, 1000);
  await pgBindReferral(db, under, referrer, 1000);
  await pgBindReferral(db, never, referrer, 1000);
  await seedTradeUsd(over, 150);
  await seedTradeUsd(under, 40);
  assert.equal(await pgCountValidInvitees(db, referrer, 100), 1);
});

test("pgCountValidInvitees: sums MULTIPLE trades (buys and sells together) toward the threshold", async () => {
  const referrer = addr();
  const w = wallet();
  await pgBindReferral(db, w, referrer, 1000);
  await seedTradeUsd(w, 60, 1);
  assert.equal(await pgCountValidInvitees(db, referrer, 100), 0, "not there yet");
  await seedTradeUsd(w, 41, 2);
  assert.equal(await pgCountValidInvitees(db, referrer, 100), 1, "101 total now — crossed it");
});

test("pgCountValidInvitees: zero for a referrer with no invitees at all", async () => {
  assert.equal(await pgCountValidInvitees(db, addr(), 100), 0);
});

test("pgInviteeVolumesUsd: one map for the whole referrer, invitees with no trades are simply absent", async () => {
  const referrer = addr();
  const traded = wallet();
  const untraded = wallet();
  await pgBindReferral(db, traded, referrer, 1000);
  await pgBindReferral(db, untraded, referrer, 1000);
  await seedTradeUsd(traded, 73);
  const volumes = await pgInviteeVolumesUsd(db, referrer);
  assert.equal(volumes[traded], 73);
  assert.equal(untraded in volumes, false);
});
