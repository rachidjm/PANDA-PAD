import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPause,
  confirmationPhrase,
  EMPTY_PAUSE_STATE,
  isPaused,
  isSubsystem,
  MAX_REASON_LENGTH,
  SUBSYSTEMS,
  validateReason,
} from "./pause";

test("nothing is paused by default", () => {
  for (const s of SUBSYSTEMS) assert.equal(isPaused(EMPTY_PAUSE_STATE, s), false);
});

test("pausing one subsystem leaves the others running, and does not mutate the old state", () => {
  const { next, changed, before } = applyPause(EMPTY_PAUSE_STATE, "holder_payouts", true, " pool mismatch ", "ADMIN", 1000);
  assert.equal(changed, true);
  assert.equal(before, null);
  assert.equal(isPaused(next, "holder_payouts"), true);
  assert.equal(isPaused(next, "token_launches"), false);
  assert.equal(next.subsystems.holder_payouts?.reason, "pool mismatch");
  assert.equal(next.subsystems.holder_payouts?.by, "ADMIN");
  assert.deepEqual(EMPTY_PAUSE_STATE.subsystems, {});
});

test("resuming records the previous state; repeating a change is a no-op", () => {
  const paused = applyPause(EMPTY_PAUSE_STATE, "holder_payouts", true, "x y z", "A", 1).next;
  const again = applyPause(paused, "holder_payouts", true, "other", "B", 2);
  assert.equal(again.changed, false);
  assert.equal(again.next, paused);
  const resumed = applyPause(paused, "holder_payouts", false, "", "A", 3);
  assert.equal(resumed.changed, true);
  assert.equal(resumed.before?.paused, true);
  assert.equal(isPaused(resumed.next, "holder_payouts"), false);
});

test("reason rules", () => {
  assert.notEqual(validateReason(true, ""), null);
  assert.notEqual(validateReason(true, "  a "), null);
  assert.notEqual(validateReason(true, undefined), null);
  assert.notEqual(validateReason(true, "x".repeat(MAX_REASON_LENGTH + 1)), null);
  assert.equal(validateReason(true, "pool mismatch"), null);
  assert.equal(validateReason(false, ""), null);
});

test("subsystem allowlist and confirmation phrase", () => {
  assert.equal(isSubsystem("holder_payouts"), true);
  for (const bad of ["", "all", "CLAIMS", "__proto__", 5, null, undefined]) assert.equal(isSubsystem(bad), false);
  assert.equal(confirmationPhrase(true, "holder_payouts"), "PAUSE holder_payouts");
  assert.equal(confirmationPhrase(false, "holder_payouts"), "RESUME holder_payouts");
});
