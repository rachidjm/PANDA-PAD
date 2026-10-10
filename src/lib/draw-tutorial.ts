import type { DictKey } from "@/lib/i18n/translations";

/**
 * Draw Your Trade's four-step tutorial: what it says, when it opens by itself, and how its buttons move. Pure, so it is
 * tested; the card and the phone sheet are in components/coin/draw/DrawTutorial.tsx.
 */

export const TUTORIAL_SEEN_KEY = "panda.draw.tutorial.seen";

/**
 * The picture of each step (public/tutorial/tutorial-1.png … tutorial-4.png). `null` = not delivered yet: a neutral
 * placeholder is shown instead — never an invented illustration, and never a request for a file that isn't there.
 */
export const TUTORIAL_IMAGES: (string | null)[] = ["/tutorial/tutorial-1.png", "/tutorial/tutorial-2.png", "/tutorial/tutorial-3.png", "/tutorial/tutorial-4.png"];

export const TUTORIAL_STEPS: DictKey[] = ["tutorial.step1", "tutorial.step2", "tutorial.step3", "tutorial.step4"];

/** It opens by itself only the first time the panel is opened; after that, only from its own button. */
export const shouldAutoShow = (panelOpen: boolean, seen: boolean) => panelOpen && !seen;

export type TutorialMove = "next" | "back";
/** Where a button takes you: the step to show, or "done" after the last one. Never before the first. */
export function moveStep(step: number, move: TutorialMove, total = TUTORIAL_STEPS.length): number | "done" {
  if (move === "back") return Math.max(0, step - 1);
  return step >= total - 1 ? "done" : step + 1;
}

// ── the guided demo ─────────────────────────────────────────────────────────────────────────────────────────────────

/** What each step lights up (a `data-tutorial` mark in the page): the Venta / Stop tabs, the % row, the chart, the sign button. */
export const TUTORIAL_TARGETS = ["tabs", "pct", "chart", "sign"] as const;
export type TutorialTarget = (typeof TUTORIAL_TARGETS)[number];

/**
 * What the DEMO shows — a picture of the panel, never the panel itself. It is derived from nothing but the step and
 * whether the step's little gesture has "landed" (`tapped`): no wallet, no balance, no order, no server. Earlier steps
 * stay done; the current one is done once tapped. Closing the tutorial simply stops drawing this — there is nothing to
 * undo, because nothing real was ever changed.
 */
export type DemoView = { sell: boolean; pct25: boolean; line: boolean; pulse: boolean };
export function demoView(step: number, tapped: boolean): DemoView {
  const done = (k: number) => step > k || (step === k && tapped);
  return { sell: done(0), pct25: done(1), line: done(2), pulse: step === 3 };
}

export type Box = { top: number; left: number; width: number; height: number };
const GAP = 14;

/**
 * Where the card goes on a desktop: beside the lit zone when there is room (right, then left), otherwise under it, then
 * over it — never on top of it — and always inside the window. (On a phone the card is a sheet at the bottom instead.)
 */
export function cardPlacement(target: Box, card: { width: number; height: number }, win: { width: number; height: number }): { top: number; left: number } {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const alongY = clamp(target.top + target.height / 2 - card.height / 2, GAP, win.height - card.height - GAP);
  const alongX = clamp(target.left + target.width / 2 - card.width / 2, GAP, win.width - card.width - GAP);
  if (right + GAP + card.width <= win.width - GAP) return { top: alongY, left: right + GAP };
  if (target.left - GAP - card.width >= GAP) return { top: alongY, left: target.left - GAP - card.width };
  if (bottom + GAP + card.height <= win.height - GAP) return { top: bottom + GAP, left: alongX };
  if (target.top - GAP - card.height >= GAP) return { top: target.top - GAP - card.height, left: alongX };
  // No free side at all (a zone as big as the window): the bottom corner, the least in the way.
  return { top: win.height - card.height - GAP, left: win.width - card.width - GAP };
}

export const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
