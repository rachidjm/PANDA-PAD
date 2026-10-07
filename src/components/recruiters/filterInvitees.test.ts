import { test } from "node:test";
import assert from "node:assert/strict";
import { averageEarnedLamports, filterInvitees, sortInvitees, type Invitee } from "./filterInvitees";

const base: Invitee = {
  wallet: "WALLETaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  state: "bound",
  boundAt: 1000,
  source: "link",
  code: null,
  active: false,
  everActivated: false,
  streakDays: 0,
  earnedLamports: 0,
  tradedVolumeUsd: 0,
  discountActive: false,
  lastTradeAt: null,
};

test("filterInvitees: 'all' with no search keeps everything", () => {
  const list = [base, { ...base, state: "pending" as const }, { ...base, state: "rejected" as const }];
  assert.equal(filterInvitees(list, { state: "all", q: "" }, 100).length, 3);
});

test("filterInvitees: q matches a substring of the wallet, case-insensitively", () => {
  const list = [base, { ...base, wallet: "OTHERbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }];
  assert.equal(filterInvitees(list, { state: "all", q: "wallet" }, 100).length, 1);
  assert.equal(filterInvitees(list, { state: "all", q: "WALLET" }, 100).length, 1);
});

test("filterInvitees: bound/pending/rejected match their own state only", () => {
  const list = [base, { ...base, state: "pending" as const }, { ...base, state: "rejected" as const }];
  assert.equal(filterInvitees(list, { state: "bound", q: "" }, 100).length, 1);
  assert.equal(filterInvitees(list, { state: "pending", q: "" }, 100).length, 1);
  assert.equal(filterInvitees(list, { state: "rejected", q: "" }, 100).length, 1);
});

test("filterInvitees: active/onTrack/inactive partition bound invitees by their streak history", () => {
  const list = [
    { ...base, active: true, everActivated: true }, // active
    { ...base, active: false, everActivated: false }, // onTrack: never activated yet
    { ...base, active: false, everActivated: true }, // inactive: was active, now isn't
    { ...base, state: "pending" as const, active: false, everActivated: false }, // never counts toward any of these
  ];
  assert.equal(filterInvitees(list, { state: "active", q: "" }, 100).length, 1);
  assert.equal(filterInvitees(list, { state: "onTrack", q: "" }, 100).length, 1);
  assert.equal(filterInvitees(list, { state: "inactive", q: "" }, 100).length, 1);
});

test("filterInvitees: validFounder/notValidFounder split on the Founder volume threshold, bound only", () => {
  const list = [
    { ...base, tradedVolumeUsd: 150 },
    { ...base, tradedVolumeUsd: 50 },
    { ...base, state: "pending" as const, tradedVolumeUsd: 999 }, // never bound, never "valid"
  ];
  assert.equal(filterInvitees(list, { state: "validFounder", q: "" }, 100).length, 1);
  assert.equal(filterInvitees(list, { state: "notValidFounder", q: "" }, 100).length, 1);
});

test("sortInvitees: earned/volume/streak/recent each sort descending by their own field", () => {
  const list = [
    { ...base, wallet: "a", earnedLamports: 1, tradedVolumeUsd: 1, streakDays: 1, boundAt: 1 },
    { ...base, wallet: "b", earnedLamports: 3, tradedVolumeUsd: 3, streakDays: 3, boundAt: 3 },
    { ...base, wallet: "c", earnedLamports: 2, tradedVolumeUsd: 2, streakDays: 2, boundAt: 2 },
  ];
  assert.deepEqual(sortInvitees(list, "earned").map((i) => i.wallet), ["b", "c", "a"]);
  assert.deepEqual(sortInvitees(list, "volume").map((i) => i.wallet), ["b", "c", "a"]);
  assert.deepEqual(sortInvitees(list, "streak").map((i) => i.wallet), ["b", "c", "a"]);
  assert.deepEqual(sortInvitees(list, "recent").map((i) => i.wallet), ["b", "c", "a"]);
});

test("sortInvitees: default is last-trade first, falling back to most-recently-bound for one with no trade", () => {
  const list = [
    { ...base, wallet: "never-traded", boundAt: 500, lastTradeAt: null },
    { ...base, wallet: "traded-recently", boundAt: 100, lastTradeAt: 900 },
    { ...base, wallet: "traded-long-ago", boundAt: 200, lastTradeAt: 300 },
  ];
  assert.deepEqual(sortInvitees(list, "default").map((i) => i.wallet), ["traded-recently", "traded-long-ago", "never-traded"]);
});

test("sortInvitees never mutates the input array", () => {
  const list = [{ ...base, wallet: "a" }, { ...base, wallet: "b", earnedLamports: 1 }];
  const copy = [...list];
  sortInvitees(list, "earned");
  assert.deepEqual(list, copy);
});

test("averageEarnedLamports: averages only over invitees who earned something, zero with none", () => {
  assert.equal(averageEarnedLamports([{ ...base, earnedLamports: 100 }, { ...base, earnedLamports: 0 }, { ...base, earnedLamports: 300 }]), 200);
  assert.equal(averageEarnedLamports([{ ...base, earnedLamports: 0 }]), 0);
  assert.equal(averageEarnedLamports([]), 0);
});
