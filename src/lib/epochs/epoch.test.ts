import { test } from "node:test";
import assert from "node:assert/strict";
import { POINTS_CONFIG } from "@/lib/points/config";
import { applyAward, emptyWalletDoc } from "@/lib/points/events";
import {
  acceptsEvents,
  canTransition,
  Epoch,
  EPOCH_STATUSES,
  epochForTime,
  isImmutable,
  newEpoch,
  validateNewEpoch,
  withStatus,
} from "./epoch";
import { buildTotals, canonicalTotalsBody, hashTotals, totalsAreIntact } from "./totals";

const H = 3_600_000;
const mk = (over: Partial<Epoch> = {}): Epoch => ({
  id: 1,
  startTime: 1000 * H,
  snapshotTime: 1168 * H,
  endTime: 1170 * H,
  rewardPool: "1000000",
  status: "UPCOMING",
  formulaVersion: "v1",
  createdAt: 0,
  ...over,
});

test("the happy path walks every state in order, and only in order", () => {
  const order = ["UPCOMING", "ACTIVE", "SNAPSHOT", "CALCULATING", "FINALIZED", "DISTRIBUTING", "COMPLETED"] as const;
  const late = 5000 * H;
  let e = mk();
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(e.status, order[i]);
    const to = order[i + 1];
    assert.equal(canTransition(e, to, late).ok, true, `${order[i]} -> ${to}`);
    e = withStatus(e, to);
  }
  assert.equal(e.status, "COMPLETED");
});

test("no skipping and no going back: every disallowed pair is refused", () => {
  const allowed = new Set([
    "UPCOMING>ACTIVE", "ACTIVE>SNAPSHOT", "SNAPSHOT>CALCULATING", "CALCULATING>FINALIZED", "FINALIZED>DISTRIBUTING", "DISTRIBUTING>COMPLETED",
    "UPCOMING>PAUSED", "ACTIVE>PAUSED", "SNAPSHOT>PAUSED", "CALCULATING>PAUSED", "DISTRIBUTING>PAUSED",
  ]);
  for (const from of EPOCH_STATUSES) {
    if (from === "PAUSED") continue;
    for (const to of EPOCH_STATUSES) {
      const r = canTransition(mk({ status: from }), to, 9999 * H);
      assert.equal(r.ok, allowed.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
});

test("a finalized epoch can't be paused, reopened or rolled back", () => {
  const e = mk({ status: "FINALIZED" });
  for (const to of ["ACTIVE", "SNAPSHOT", "CALCULATING", "PAUSED", "UPCOMING"] as const) assert.equal(canTransition(e, to, 9999 * H).ok, false);
  assert.equal(isImmutable(e), true);
  assert.equal(isImmutable(mk({ status: "ACTIVE" })), false);
});

test("pause remembers where it came from and resumes only there", () => {
  const active = mk({ status: "ACTIVE" });
  const paused = withStatus(active, "PAUSED");
  assert.equal(paused.pausedFrom, "ACTIVE");
  assert.equal(acceptsEvents(paused), false);
  assert.equal(canTransition(paused, "FINALIZED", 9999 * H).ok, false);
  assert.equal(canTransition(paused, "ACTIVE", 9999 * H).ok, true);
  const resumed = withStatus(paused, "ACTIVE");
  assert.equal(resumed.pausedFrom, undefined);
  assert.equal(acceptsEvents(resumed), true);
});

test("timing rules: can't activate before start, can't snapshot before snapshot time + grace", () => {
  assert.equal(canTransition(mk(), "ACTIVE", 1000 * H - 1).ok, false);
  assert.equal(canTransition(mk(), "ACTIVE", 1000 * H).ok, true);
  const active = mk({ status: "ACTIVE" });
  assert.equal(canTransition(active, "SNAPSHOT", 1168 * H).ok, false);
  assert.equal(canTransition(active, "SNAPSHOT", 1168 * H + POINTS_CONFIG.snapshotGraceMs - 1).ok, false);
  assert.equal(canTransition(active, "SNAPSHOT", 1168 * H + POINTS_CONFIG.snapshotGraceMs).ok, true);
});

test("events belong to an epoch by time; the snapshot boundary is exclusive", () => {
  const e = mk();
  assert.equal(epochForTime([e], 1000 * H)?.id, 1);
  assert.equal(epochForTime([e], 1168 * H - 1)?.id, 1);
  assert.equal(epochForTime([e], 1168 * H), null);
  assert.equal(epochForTime([e], 1000 * H - 1), null);
});

test("new-epoch validation", () => {
  const now = 900 * H;
  const ok = { startTime: 1000 * H, snapshotTime: 1168 * H, endTime: 1170 * H, rewardPool: "5000000000000" };
  assert.equal(validateNewEpoch(ok, [], now), null);
  assert.notEqual(validateNewEpoch({ ...ok, snapshotTime: 999 * H }, [], now), null, "snapshot before start");
  assert.notEqual(validateNewEpoch({ ...ok, snapshotTime: 1171 * H }, [], now), null, "snapshot after end");
  assert.notEqual(validateNewEpoch({ ...ok, snapshotTime: 1000 * H + 60_000 }, [], now), null, "under 1h");
  assert.notEqual(validateNewEpoch({ ...ok, endTime: 1000 * H + 91 * 24 * H }, [], now), null, "over 90d");
  assert.notEqual(validateNewEpoch({ ...ok, startTime: 1 * H, snapshotTime: 5 * H, endTime: 6 * H }, [], now), null, "already over");
  for (const rewardPool of ["", "-1", "1.5", "1e9", "abc", "1".repeat(31), " 1"]) {
    assert.notEqual(validateNewEpoch({ ...ok, rewardPool }, [], now), null, rewardPool);
  }
  const existing = [mk({ startTime: 1100 * H, endTime: 1300 * H })];
  assert.notEqual(validateNewEpoch(ok, existing, now), null, "overlap");
  assert.equal(validateNewEpoch({ ...ok, startTime: 1300 * H, snapshotTime: 1400 * H, endTime: 1401 * H }, existing, now), null, "back to back is fine");
});

test("epoch ids are sequential and start UPCOMING", () => {
  const first = newEpoch({ startTime: 1, snapshotTime: 2, endTime: 3, rewardPool: "1" }, [], 0);
  assert.equal(first.id, 1);
  assert.equal(first.status, "UPCOMING");
  assert.equal(newEpoch({ startTime: 1, snapshotTime: 2, endTime: 3, rewardPool: "1" }, [first], 0).id, 2);
});

// ---- totals --------------------------------------------------------------

const docWith = (wallet: string, points: number) =>
  applyAward(emptyWalletDoc(wallet, 1), { eventId: `evt-${wallet}-campaign`, wallet, type: "campaign", source: "t", ts: 5, points, epoch: 1, reason: "r" }, 9).next;

test("totals are deterministic regardless of input order, sorted, and hash-pinned", () => {
  const a = buildTotals(1, "v1", [docWith("B", 30), docWith("A", 20), docWith("C", 50)]);
  const b = buildTotals(1, "v1", [docWith("C", 50), docWith("A", 20), docWith("B", 30)]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.entries.map((e) => e.wallet), ["A", "B", "C"]);
  assert.equal(a.totalPoints, 100);
  assert.equal(a.hash, hashTotals(canonicalTotalsBody(1, "v1", a.entries)));
  assert.equal(totalsAreIntact(a), true);
});

test("tampering with stored totals is detected", () => {
  const t = buildTotals(1, "v1", [docWith("A", 20), docWith("B", 30)]);
  assert.equal(totalsAreIntact({ ...t, entries: [{ wallet: "A", points: 9999 }, t.entries[1]] }), false);
  assert.equal(totalsAreIntact({ ...t, totalPoints: t.totalPoints + 1 }), false);
  assert.equal(totalsAreIntact({ ...t, formulaVersion: "v2" }), false);
  assert.equal(totalsAreIntact({ ...t, hash: "0".repeat(64) }), false);
});

test("totals skip zero wallets and held events, and refuse documents from another epoch", () => {
  const held = { ...docWith("H", 40), events: docWith("H", 40).events.map((e) => ({ ...e, status: "held" as const })) };
  const t = buildTotals(1, "v1", [docWith("A", 20), held]);
  assert.deepEqual(t.entries, [{ wallet: "A", points: 20 }]);
  assert.throws(() => buildTotals(2, "v1", [docWith("A", 20)]));
});
