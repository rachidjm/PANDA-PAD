import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgBindReferral, pgGetReferralStreak } from "@/lib/db/referrals";
import { recordReferralVolumeAndStreak } from "./streak";

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
  process.env.REFERRAL_MIN_DAILY_VOLUME_SOL = "0.05";
});

const SOL = 1_000_000_000;
const DAY = 86_400_000;
const DAY1 = Date.parse("2026-03-01T12:00:00Z");

test("a wallet with no referrer: no-op, no row written", async () => {
  const w = `W${Math.random()}`;
  await recordReferralVolumeAndStreak(w, 0.1 * SOL, DAY1);
  assert.equal(await pgGetReferralStreak(db, w), null);
});

test("below the daily minimum: no streak day counted", async () => {
  const referrer = `R${Math.random()}`;
  const w = `W${Math.random()}`;
  await pgBindReferral(db, w, referrer, DAY1);
  await recordReferralVolumeAndStreak(w, 0.01 * SOL, DAY1); // well under 0.05 SOL
  const state = await pgGetReferralStreak(db, w);
  assert.equal(state!.lastQualifyingDay, null);
  assert.equal(state!.streakAtLastQualifyingDay, 0);
});

test("one trade that alone crosses the minimum counts that day; a second trade the same day doesn't double-count", async () => {
  const referrer = `R${Math.random()}`;
  const w = `W${Math.random()}`;
  await pgBindReferral(db, w, referrer, DAY1);
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1);
  let state = await pgGetReferralStreak(db, w);
  assert.equal(state!.streakAtLastQualifyingDay, 1);
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1 + 60_000); // later the same UTC day
  state = await pgGetReferralStreak(db, w);
  assert.equal(state!.streakAtLastQualifyingDay, 1, "still 1 — the day was already counted");
});

test("several smaller trades the same day that TOGETHER cross the minimum count the day once, on the trade that tips it over", async () => {
  const referrer = `R${Math.random()}`;
  const w = `W${Math.random()}`;
  await pgBindReferral(db, w, referrer, DAY1);
  await recordReferralVolumeAndStreak(w, 0.03 * SOL, DAY1);
  assert.equal((await pgGetReferralStreak(db, w))!.streakAtLastQualifyingDay, 0, "0.03 alone isn't enough");
  await recordReferralVolumeAndStreak(w, 0.03 * SOL, DAY1 + 1000); // 0.06 total now
  assert.equal((await pgGetReferralStreak(db, w))!.streakAtLastQualifyingDay, 1);
});

test("3 consecutive qualifying UTC days activates, fixing firstActivatedAt exactly once", async () => {
  const referrer = `R${Math.random()}`;
  const w = `W${Math.random()}`;
  await pgBindReferral(db, w, referrer, DAY1);
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1);
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1 + DAY);
  let state = await pgGetReferralStreak(db, w);
  assert.equal(state!.streakAtLastQualifyingDay, 2);
  assert.equal(state!.firstActivatedAt, null, "not active yet");

  const activatedAt = DAY1 + 2 * DAY + 5000;
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, activatedAt);
  state = await pgGetReferralStreak(db, w);
  assert.equal(state!.streakAtLastQualifyingDay, 3);
  assert.equal(state!.firstActivatedAt, activatedAt);

  // A 4th consecutive day doesn't move firstActivatedAt.
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1 + 3 * DAY);
  state = await pgGetReferralStreak(db, w);
  assert.equal(state!.streakAtLastQualifyingDay, 4);
  assert.equal(state!.firstActivatedAt, activatedAt, "fixed forever, never updated again");
});

test("a gap resets the streak to 1, but never clears an already-fixed firstActivatedAt", async () => {
  const referrer = `R${Math.random()}`;
  const w = `W${Math.random()}`;
  await pgBindReferral(db, w, referrer, DAY1);
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1);
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1 + DAY);
  const activatedAt = DAY1 + 2 * DAY;
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, activatedAt); // streak = 3, activates

  // Skip a day (DAY1+3DAY has no qualifying trade), then trade again on DAY1+4DAY — not consecutive, streak resets.
  await recordReferralVolumeAndStreak(w, 0.06 * SOL, DAY1 + 4 * DAY);
  const state = await pgGetReferralStreak(db, w);
  assert.equal(state!.streakAtLastQualifyingDay, 1, "the gap breaks the streak");
  assert.equal(state!.firstActivatedAt, activatedAt, "but the original activation date is never erased");
});
