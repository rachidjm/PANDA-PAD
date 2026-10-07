import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatedPct, canAddPct, placeLeg, remainingPct, removeLeg, removeTranche, setTranchePct, trancheKind, updateLegPrice, validateTranches } from "./allocation";

test("remaining/allocated start at 0/100 with no tranches", () => {
  assert.equal(allocatedPct([]), 0);
  assert.equal(remainingPct([]), 100);
  assert.equal(canAddPct([], 100), true);
  assert.equal(canAddPct([], 101), false);
  assert.equal(canAddPct([], 0), false);
});

test("placing a sell creates one tranche and consumes its share", () => {
  const t1 = placeLeg([], "sell", 25, 0.002);
  assert.deepEqual(t1, [{ id: t1[0].id, pct: 25, sell: 0.002 }]);
  assert.equal(remainingPct(t1), 75);
});

test("a sell and a stop at the SAME pct pair into one tranche (oco), not two", () => {
  let t = placeLeg([], "sell", 25, 0.002);
  t = placeLeg(t, "stop", 25, 0.0008);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0], { id: t[0].id, pct: 25, sell: 0.002, stop: 0.0008 });
  assert.equal(allocatedPct(t), 25); // counted once, not 50
  assert.equal(trancheKind(t[0]), "sell_stop");
});

test("a sell and a stop at DIFFERENT pcts stay as two independent tranches", () => {
  let t = placeLeg([], "sell", 25, 0.002);
  t = placeLeg(t, "stop", 50, 0.0008);
  assert.equal(t.length, 2);
  assert.equal(allocatedPct(t), 75);
});

test("placing a second sell at the SAME pct as an existing sell-only tranche adds a new tranche, never overwrites", () => {
  let t = placeLeg([], "sell", 25, 0.002);
  t = placeLeg(t, "sell", 25, 0.003);
  assert.equal(t.length, 2);
  assert.equal(allocatedPct(t), 50);
});

test("placing over the remaining allocation is a no-op", () => {
  const t = placeLeg([{ id: "a", pct: 80, sell: 0.002 }], "sell", 30, 0.003);
  assert.equal(t.length, 1); // 80 + 30 > 100, refused
});

test("sum of several tranches can reach exactly 100 but never pass it", () => {
  let t = placeLeg([], "sell", 60, 0.002);
  t = placeLeg(t, "sell", 40, 0.0021);
  assert.equal(allocatedPct(t), 100);
  assert.equal(remainingPct(t), 0);
  t = placeLeg(t, "stop", 1, 0.0007); // nothing left
  assert.equal(allocatedPct(t), 100);
});

test("updateLegPrice moves only the leg asked for, on the right tranche", () => {
  let t = placeLeg([], "sell", 25, 0.002);
  t = placeLeg(t, "stop", 25, 0.0008);
  const moved = updateLegPrice(t, t[0].id, "sell", 0.0025);
  assert.equal(moved[0].sell, 0.0025);
  assert.equal(moved[0].stop, 0.0008);
});

test("removeLeg drops just that leg, and the whole tranche once both legs are gone", () => {
  let t = placeLeg([], "sell", 25, 0.002);
  t = placeLeg(t, "stop", 25, 0.0008);
  const id = t[0].id;
  t = removeLeg(t, id, "sell");
  assert.deepEqual(t, [{ id, pct: 25, stop: 0.0008 }]);
  t = removeLeg(t, id, "stop");
  assert.deepEqual(t, []);
});

test("removeTranche drops the whole line regardless of how many legs it has", () => {
  const t = removeTranche([{ id: "a", pct: 25, sell: 1 }, { id: "b", pct: 10, stop: 2 }], "a");
  assert.deepEqual(t, [{ id: "b", pct: 10, stop: 2 }]);
});

test("setTranchePct respects what the OTHER tranches already hold", () => {
  const base = [{ id: "a", pct: 20, sell: 1 }, { id: "b", pct: 30, sell: 2 }];
  assert.deepEqual(setTranchePct(base, "a", 80), base); // 80 + 30 > 100, refused
  const ok = setTranchePct(base, "a", 50);
  assert.equal(ok.find((t) => t.id === "a")?.pct, 50);
});

test("setTranchePct rejects out-of-range values", () => {
  const base = [{ id: "a", pct: 20, sell: 1 }];
  assert.deepEqual(setTranchePct(base, "a", 0), base);
  assert.deepEqual(setTranchePct(base, "a", 101), base);
});

test("trancheKind reads sell/stop/sell_stop off the tranche's own legs", () => {
  assert.equal(trancheKind({ id: "a", pct: 25, sell: 1 }), "sell");
  assert.equal(trancheKind({ id: "a", pct: 25, stop: 1 }), "stop");
  assert.equal(trancheKind({ id: "a", pct: 25, sell: 1, stop: 0.5 }), "sell_stop");
});

test("validateTranches: a sell below current price is flagged on its own tranche only", () => {
  const tranches = [
    { id: "ok", pct: 50, sell: 2 },
    { id: "bad", pct: 25, sell: 0.5 },
  ];
  const issues = validateTranches(tranches, { currentUsd: 1, balanceUsd: 1000 });
  assert.deepEqual(issues.get("ok"), []);
  assert.ok(issues.get("bad")!.includes("sell_not_above_current"));
});

test("validateTranches: a tranche's own slice below the $10 minimum is flagged, others aren't", () => {
  const tranches = [
    { id: "big", pct: 90, sell: 2 },
    { id: "tiny", pct: 1, sell: 2 },
  ];
  const issues = validateTranches(tranches, { currentUsd: 1, balanceUsd: 100 }); // tiny's slice: $1
  assert.deepEqual(issues.get("big"), []);
  assert.ok(issues.get("tiny")!.includes("below_minimum"));
});

test("validateTranches: an unknown balance flags every tranche with no_balance, never silently passes", () => {
  const issues = validateTranches([{ id: "a", pct: 50, sell: 2 }], { currentUsd: 1, balanceUsd: null });
  assert.ok(issues.get("a")!.includes("no_balance"));
});
