import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgBindReferral, pgSetReferralStreak } from "@/lib/db/referrals";
import { activeCutoffDay, bpsForRank, commissionBpsFor, DEFAULT_REFERRAL_TIERS, isCurrentlyActive, isValidReferralTiersJson, referralMinDailyVolumeLamports, referralTiers } from "./tiers";

test("bpsForRank: the default tiers (500/1,500 boundaries, 30/25/20%)", () => {
  assert.equal(bpsForRank(1), 3000);
  assert.equal(bpsForRank(500), 3000, "the boundary itself is still the cheaper tier");
  assert.equal(bpsForRank(501), 2500);
  assert.equal(bpsForRank(1500), 2500);
  assert.equal(bpsForRank(1501), 2000);
  assert.equal(bpsForRank(50_000), 2000, "the open-ended last tier never runs out");
});

test("referralTiers: falls back to the default on anything malformed, never a partially-trusted value", () => {
  assert.deepEqual(referralTiers({}), DEFAULT_REFERRAL_TIERS);
  assert.deepEqual(referralTiers({ REFERRAL_TIERS: "not json" }), DEFAULT_REFERRAL_TIERS);
  assert.deepEqual(referralTiers({ REFERRAL_TIERS: "[]" }), DEFAULT_REFERRAL_TIERS, "empty array");
  assert.deepEqual(referralTiers({ REFERRAL_TIERS: JSON.stringify([{ upTo: 500, bps: 3000 }]) }), DEFAULT_REFERRAL_TIERS, "last entry must be upTo:null");
  assert.deepEqual(referralTiers({ REFERRAL_TIERS: JSON.stringify([{ upTo: 500, bps: 20_000 }, { upTo: null, bps: 1000 }]) }), DEFAULT_REFERRAL_TIERS, "bps out of range");
  assert.deepEqual(
    referralTiers({ REFERRAL_TIERS: JSON.stringify([{ upTo: 200, bps: 100 }, { upTo: 100, bps: 50 }, { upTo: null, bps: 10 }]) }),
    DEFAULT_REFERRAL_TIERS,
    "not strictly ascending"
  );
  const custom = [{ upTo: 100, bps: 4000 }, { upTo: null, bps: 1000 }];
  assert.deepEqual(referralTiers({ REFERRAL_TIERS: JSON.stringify(custom) }), custom);
});

test("isValidReferralTiersJson mirrors referralTiers' own acceptance", () => {
  assert.equal(isValidReferralTiersJson(JSON.stringify(DEFAULT_REFERRAL_TIERS)), true);
  assert.equal(isValidReferralTiersJson("not json"), false);
  assert.equal(isValidReferralTiersJson(JSON.stringify([{ upTo: 500, bps: 3000 }])), false);
});

test("referralMinDailyVolumeLamports: default 0.05 SOL, configurable, never zero/negative/NaN", () => {
  assert.equal(referralMinDailyVolumeLamports({}), 50_000_000);
  assert.equal(referralMinDailyVolumeLamports({ REFERRAL_MIN_DAILY_VOLUME_SOL: "0.1" }), 100_000_000);
  assert.equal(referralMinDailyVolumeLamports({ REFERRAL_MIN_DAILY_VOLUME_SOL: "0" }), 50_000_000);
  assert.equal(referralMinDailyVolumeLamports({ REFERRAL_MIN_DAILY_VOLUME_SOL: "not a number" }), 50_000_000);
});

test("activeCutoffDay: exactly 2 days before now (so a lastQualifyingDay of today, yesterday or the day before still counts active)", () => {
  const now = Date.parse("2026-03-10T12:00:00Z");
  assert.equal(activeCutoffDay(now), "2026-03-08");
});

test("isCurrentlyActive: streak must be >=3 AND the last qualifying day within the active window", () => {
  const now = Date.parse("2026-03-10T12:00:00Z");
  assert.equal(isCurrentlyActive({ lastQualifyingDay: "2026-03-10", streakAtLastQualifyingDay: 3 }, now), true, "qualified today");
  assert.equal(isCurrentlyActive({ lastQualifyingDay: "2026-03-08", streakAtLastQualifyingDay: 5 }, now), true, "exactly at the cutoff, still active");
  assert.equal(isCurrentlyActive({ lastQualifyingDay: "2026-03-07", streakAtLastQualifyingDay: 5 }, now), false, "one day past the cutoff: 3 full quiet days have passed");
  assert.equal(isCurrentlyActive({ lastQualifyingDay: "2026-03-10", streakAtLastQualifyingDay: 2 }, now), false, "never reached 3 in a row");
  assert.equal(isCurrentlyActive({ lastQualifyingDay: null, streakAtLastQualifyingDay: 0 }, now), false);
});

// ── commissionBpsFor: the live, DB-backed rank/tier lookup ──────────────────────────────────────────────────────

let db: Db;
const SAVED = { ...process.env };
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => {
  setDbForTests(null);
  process.env = SAVED;
});
beforeEach(() => {
  process.env.FEATURE_REFERRALS = "true";
});

const NOW = Date.parse("2026-03-10T12:00:00Z");
const TODAY = "2026-03-10";

/** Binds `wallet` to `referrer` and marks it active as of `firstActivatedAt`, with its streak's last qualifying
 *  day set to TODAY (so it reads as currently active under the fixed NOW used throughout this block). */
async function bindActive(wallet: string, referrer: string, firstActivatedAt: number) {
  await pgBindReferral(db, wallet, referrer, firstActivatedAt);
  await pgSetReferralStreak(db, wallet, { lastQualifyingDay: TODAY, streakAtLastQualifyingDay: 3, firstActivatedAt });
}

test("commissionBpsFor: a referrer's very first invitee, never activated, ranks 1st (the back of an empty queue)", async () => {
  const referrer = `R${Math.random()}`;
  const invitee = `I${Math.random()}`;
  await pgBindReferral(db, invitee, referrer, NOW);
  assert.equal(await commissionBpsFor(referrer, invitee, NOW), 3000);
});

test("commissionBpsFor: rank is live — when an earlier-activated invitee deactivates, everyone after them moves up, never down", async () => {
  process.env.REFERRAL_TIERS = JSON.stringify([{ upTo: 1, bps: 3000 }, { upTo: 2, bps: 2500 }, { upTo: null, bps: 2000 }]);
  const referrer = `R${Math.random()}`;
  const first = `I${Math.random()}`;
  const second = `I${Math.random()}`;
  await bindActive(first, referrer, NOW - 2 * 86_400_000);
  await bindActive(second, referrer, NOW - 1 * 86_400_000);

  // Both active: first is rank 1 (30%), second is rank 2 (25%).
  assert.equal(await commissionBpsFor(referrer, first, NOW), 3000);
  assert.equal(await commissionBpsFor(referrer, second, NOW), 2500);

  // `first` goes quiet (its last qualifying day falls outside the active window) — `second` moves up to rank 1.
  await pgSetReferralStreak(db, first, { lastQualifyingDay: "2026-02-01", streakAtLastQualifyingDay: 3, firstActivatedAt: NOW - 2 * 86_400_000 });
  assert.equal(await commissionBpsFor(referrer, second, NOW), 3000, "moved up — never worse than before");
  // `first`'s own trades still use "the tier it would get if active" — still rank 1 by original arrival order (second is now active and arrived later).
  assert.equal(await commissionBpsFor(referrer, first, NOW), 3000);
});

test("commissionBpsFor: a never-activated invitee always ranks behind every currently-active one", async () => {
  process.env.REFERRAL_TIERS = JSON.stringify([{ upTo: 1, bps: 3000 }, { upTo: null, bps: 2000 }]);
  const referrer = `R${Math.random()}`;
  const active = `I${Math.random()}`;
  const neverActivated = `I${Math.random()}`;
  await bindActive(active, referrer, NOW);
  await pgBindReferral(db, neverActivated, referrer, NOW);
  assert.equal(await commissionBpsFor(referrer, active, NOW), 3000);
  assert.equal(await commissionBpsFor(referrer, neverActivated, NOW), 2000, "ranks behind the one active invitee");
});
