import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignActive, campaignWindow, daysLeft, referralShareBps } from "./constants";

const ENV = { REFERRAL_START: "2026-01-01T00:00:00Z", REFERRAL_END: "2026-01-31T00:00:00Z" };

test("campaignWindow: null without both real, ordered ISO instants — never a guessed window", () => {
  assert.equal(campaignWindow({}), null);
  assert.equal(campaignWindow({ REFERRAL_START: "2026-01-01T00:00:00Z" }), null);
  assert.equal(campaignWindow({ REFERRAL_START: "not a date", REFERRAL_END: "2026-01-31T00:00:00Z" }), null);
  assert.equal(campaignWindow({ REFERRAL_START: "2026-02-01T00:00:00Z", REFERRAL_END: "2026-01-01T00:00:00Z" }), null, "end before start");
  assert.deepEqual(campaignWindow(ENV), { start: Date.parse(ENV.REFERRAL_START), end: Date.parse(ENV.REFERRAL_END) });
});

test("campaignActive: true only strictly inside [start, end)", () => {
  const start = Date.parse(ENV.REFERRAL_START);
  const end = Date.parse(ENV.REFERRAL_END);
  assert.equal(campaignActive(start - 1, ENV), false);
  assert.equal(campaignActive(start, ENV), true);
  assert.equal(campaignActive(start + 1000, ENV), true);
  assert.equal(campaignActive(end - 1, ENV), true);
  assert.equal(campaignActive(end, ENV), false, "end is exclusive");
  assert.equal(campaignActive(Date.now(), {}), false, "no campaign configured");
});

test("daysLeft: whole days remaining, null outside the campaign", () => {
  const start = Date.parse(ENV.REFERRAL_START);
  const end = Date.parse(ENV.REFERRAL_END);
  assert.equal(daysLeft(end - 1, ENV), 1);
  assert.equal(daysLeft(end - 86_400_000 - 1, ENV), 2);
  assert.equal(daysLeft(start, ENV), 30);
  assert.equal(daysLeft(end, ENV), null);
  assert.equal(daysLeft(start - 1, ENV), null);
});

test("referralShareBps: the configured value when it's a real bps, else the documented default", () => {
  assert.equal(referralShareBps({ REFERRAL_SHARE_BPS: "2500" }), 2500);
  assert.equal(referralShareBps({}), 3000);
  assert.equal(referralShareBps({ REFERRAL_SHARE_BPS: "not a number" }), 3000);
  assert.equal(referralShareBps({ REFERRAL_SHARE_BPS: "10001" }), 3000, "out of range");
  assert.equal(referralShareBps({ REFERRAL_SHARE_BPS: "0" }), 0);
});
