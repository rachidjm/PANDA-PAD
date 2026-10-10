import { test } from "node:test";
import assert from "node:assert/strict";
import { moveStep, shouldAutoShow, TUTORIAL_IMAGES, TUTORIAL_STEPS } from "./draw-tutorial";
import { hasUnseen } from "./updates/seen";
import { dict } from "./i18n/translations";

test("the tutorial has four steps, each with its text in English and Spanish and a picture slot", () => {
  assert.equal(TUTORIAL_STEPS.length, 4);
  assert.equal(TUTORIAL_IMAGES.length, 4);
  for (const key of TUTORIAL_STEPS) {
    const entry = (dict as Record<string, { en: string; es: string }>)[key];
    assert.ok(entry.en.length > 10 && entry.es.length > 10 && entry.en !== entry.es, key);
  }
  for (const src of TUTORIAL_IMAGES) assert.ok(src === null || /^\/tutorial\/tutorial-[1-4]\.(png|webp)$/.test(src), String(src));
});

test("it opens by itself only the first time the panel is open; never while the panel is folded, never once seen", () => {
  assert.equal(shouldAutoShow(true, false), true);
  assert.equal(shouldAutoShow(true, true), false);
  assert.equal(shouldAutoShow(false, false), false);
});

test("Siguiente walks to the last step and then finishes; Atrás never goes before the first", () => {
  assert.deepEqual([moveStep(0, "next"), moveStep(1, "next"), moveStep(2, "next"), moveStep(3, "next")], [1, 2, 3, "done"]);
  assert.deepEqual([moveStep(3, "back"), moveStep(1, "back"), moveStep(0, "back")], [2, 0, 0]);
});

test("the 'new' dot: on while the newest update isn't the one remembered; off with no updates or once seen", () => {
  assert.equal(hasUnseen("2026-10-10-a", null), true, "a first visit has seen nothing");
  assert.equal(hasUnseen("2026-10-11-b", "2026-10-10-a"), true);
  assert.equal(hasUnseen("2026-10-10-a", "2026-10-10-a"), false);
  assert.equal(hasUnseen(null, null), false);
  assert.equal(hasUnseen(undefined, "2026-10-10-a"), false);
});
