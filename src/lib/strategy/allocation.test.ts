import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatedPct, canAddPct, heldStatus, minPctForOrder, pctForNewLeg, pickHeldDraft, placeLeg, remainingPct, removeLeg, removeTranche, setTranchePct, trancheKind, trancheUsd, updateLegPrice, validateTranches } from "./allocation";

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

test("pctForNewLeg: a fresh draft claims the whole balance — no compra previa needed to place a first sell or stop", () => {
  assert.equal(pctForNewLeg([], "sell"), 100);
  assert.equal(pctForNewLeg([], "stop"), 100);
});

test("pctForNewLeg: a lone sell at 100% pairs the next stop into the SAME slice (one OCO), not a separate one", () => {
  const t = placeLeg([], "sell", 100, 0.002);
  assert.equal(pctForNewLeg(t, "stop"), 100);
  const combined = placeLeg(t, "stop", pctForNewLeg(t, "stop"), 0.0008);
  assert.equal(combined.length, 1);
  assert.equal(trancheKind(combined[0]), "sell_stop");
});

test("pctForNewLeg: a lone stop pairs the next sell the same way", () => {
  const t = placeLeg([], "stop", 50, 0.0008);
  assert.equal(pctForNewLeg(t, "sell"), 50);
});

test("pctForNewLeg: with no partner to join, claims whatever is left — 0 once fully allocated AND fully paired", () => {
  let t = placeLeg([], "sell", 60, 0.002);
  assert.equal(pctForNewLeg(t, "sell"), 40); // a second, independent sell slice (the first is still un-paired)
  t = placeLeg(t, "stop", 60, 0.0007); // pairs the first slice into one oco
  t = placeLeg(t, "sell", 40, 0.0021);
  t = placeLeg(t, "stop", 40, 0.0006); // pairs the second slice too
  assert.equal(pctForNewLeg(t, "sell"), 0);
  assert.equal(pctForNewLeg(t, "stop"), 0);
});

// ── a coin the wallet already holds: sell / stop / oco with no purchase first ─────────────────────────────────

test("heldStatus: a real positive balance unlocks sell/stop without a buy; 0 is 'none'; not read yet is never 'none'", () => {
  assert.equal(heldStatus(1234.5), "has");
  assert.equal(heldStatus(0), "none");
  assert.equal(heldStatus(null), "unknown");
  assert.equal(heldStatus(Number.NaN), "unknown");
});

test("with balance: the first Venta tap claims 100% of the free balance, a Stop then pairs into ONE oco on that same slice", () => {
  let t = placeLeg([], "sell", pctForNewLeg([], "sell"), 2);
  assert.equal(t[0].pct, 100);
  t = placeLeg(t, "stop", pctForNewLeg(t, "stop"), 0.5);
  assert.equal(t.length, 1);
  assert.equal(trancheKind(t[0]), "sell_stop");
  const issues = validateTranches(t, { currentUsd: 1, balanceUsd: 500 });
  assert.deepEqual(issues.get(t[0].id), [], "sell above, stop below, $500 ≥ $10: ready to sign");
});

test("with balance: stop only and sell only are each a valid order on their own (no buy needed)", () => {
  const stop = placeLeg([], "stop", 100, 0.5);
  assert.equal(trancheKind(stop[0]), "stop");
  assert.deepEqual(validateTranches(stop, { currentUsd: 1, balanceUsd: 50 }).get(stop[0].id), []);
  const sell = placeLeg([], "sell", 50, 3);
  assert.equal(trancheKind(sell[0]), "sell");
  assert.deepEqual(validateTranches(sell, { currentUsd: 1, balanceUsd: 50 }).get(sell[0].id), []);
});

test("without balance: every held-coin line is refused (no_balance), so nothing can be signed", () => {
  const t = placeLeg([], "sell", 100, 2);
  assert.ok(validateTranches(t, { currentUsd: 1, balanceUsd: 0 }).get(t[0].id)!.includes("no_balance"));
});

test("partly committed: 60% already drawn leaves 40% — a new line takes only what's left and 100% can't be picked", () => {
  const t = placeLeg([], "sell", 60, 2);
  assert.equal(pctForNewLeg(t, "sell"), 40);
  assert.equal(canAddPct(t, 100), false);
  assert.equal(canAddPct(t, 40), true);
  assert.deepEqual(setTranchePct(t, t[0].id, 100).map((x) => x.pct), [100], "its own % can still grow while nothing else is drawn");
  const two = placeLeg(t, "sell", 40, 3);
  assert.deepEqual(setTranchePct(two, two[0].id, 75).map((x) => x.pct), [60, 40], "never past 100% in total");
});

test("partly committed in open orders: the % is of the FREE balance the wallet reads (tokens in orders are in Jupiter's vault)", () => {
  // 1,000 tokens at $0.05, 600 of them already deposited in an open order → the wallet reads 400 ($20).
  const freeUsd = 400 * 0.05;
  assert.equal(trancheUsd(freeUsd, 100), 20);
  assert.equal(trancheUsd(freeUsd, 50), 10);
  assert.equal(trancheUsd(null, 50), null);
  const t = placeLeg([], "sell", 25, 0.1); // 25% of $20 = $5
  assert.ok(validateTranches(t, { currentUsd: 0.05, balanceUsd: freeUsd }).get(t[0].id)!.includes("below_minimum"));
});

test("under $10: a % worth less than the minimum is flagged (can't sign), and minPctForOrder says the smallest % that works", () => {
  // $30 balance: 25% = $7.50 (too small), 34% = $10.20 (ok).
  const t = placeLeg([], "stop", 25, 0.5);
  assert.ok(validateTranches(t, { currentUsd: 1, balanceUsd: 30 }).get(t[0].id)!.includes("below_minimum"));
  assert.equal(minPctForOrder(30), 34);
  assert.equal(minPctForOrder(10), 100);
  assert.equal(minPctForOrder(1000), 1);
  assert.equal(minPctForOrder(5), 200, "even 100% isn't enough");
  assert.equal(minPctForOrder(0), Infinity);
  assert.equal(minPctForOrder(null), null);
});

test("sell must be above and stop below the CURRENT market price, or the line can't be signed", () => {
  const sellLow = placeLeg([], "sell", 100, 0.9);
  assert.ok(validateTranches(sellLow, { currentUsd: 1, balanceUsd: 100 }).get(sellLow[0].id)!.includes("sell_not_above_current"));
  const stopHigh = placeLeg([], "stop", 100, 1.1);
  assert.ok(validateTranches(stopHigh, { currentUsd: 1, balanceUsd: 100 }).get(stopHigh[0].id)!.includes("stop_not_below_current"));
});

test("pickHeldDraft: a top-level Venta/Stop joins the active held-coin draft, else the latest one — never a draft with a buy", () => {
  const drafts = [{ id: "a" }, { id: "b", buy: 1 }, { id: "c" }];
  assert.equal(pickHeldDraft(drafts, "a")?.id, "a");
  assert.equal(pickHeldDraft(drafts, null)?.id, "c");
  assert.equal(pickHeldDraft(drafts, "b"), null, "the active buy draft keeps its own sell/stop legs");
  assert.equal(pickHeldDraft([{ id: "b", buy: 1 }], null), null);
});

test("PANDA orders have no $10 floor (minOrderUsd 0): a 5% line worth cents is valid; Jupiter's held-coin path still flags it", () => {
  const t = placeLeg([], "sell", 5, 2); // 5% of $20 = $1
  assert.deepEqual(validateTranches(t, { currentUsd: 1, balanceUsd: 20, minOrderUsd: 0 }).get(t[0].id), []);
  assert.ok(validateTranches(t, { currentUsd: 1, balanceUsd: 20 }).get(t[0].id)!.includes("below_minimum"));
});
