import { test } from "node:test";
import assert from "node:assert/strict";
import { firstProblem, orderCount } from "./problem";
import { allocatedPct, placeLeg } from "./allocation";

test("one message: going over 100% of the balance comes first, whatever else is wrong", () => {
  assert.equal(firstProblem(["sell_not_above_current", "below_minimum"], 110), "over_100");
  assert.equal(firstProblem([], 100), null);
  assert.equal(firstProblem([], 100.5), "over_100");
});

test("then: no coin, no price, a line on the wrong side of the price, then the softer rules", () => {
  assert.equal(firstProblem(["below_minimum", "no_balance"]), "no_balance");
  assert.equal(firstProblem(["too_far", "stop_not_below_current"]), "stop_not_below_current");
  assert.equal(firstProblem(["liquidity_low", "below_minimum"]), "below_minimum");
  assert.equal(firstProblem(["something_new"]), "something_new", "an unknown issue is still shown, never swallowed");
});

test("the marked % goes on every new line: 10% sell, 20% sell, a 10% stop pairs with the 10% sell; past 100% is drawn and reported", () => {
  let t = placeLeg([], "sell", 10, 2, { allowOver: true });
  t = placeLeg(t, "sell", 20, 3, { allowOver: true });
  t = placeLeg(t, "stop", 10, 0.5, { allowOver: true });
  assert.equal(t.length, 2);
  assert.equal(orderCount(t), 3, "Firmar 3 órdenes");
  t = placeLeg(t, "sell", 100, 4, { allowOver: true });
  assert.equal(allocatedPct(t), 130);
  assert.equal(firstProblem([], allocatedPct(t)), "over_100");
  assert.equal(placeLeg([], "sell", 0, 2, { allowOver: true }).length, 0, "never a 0% line");
});
