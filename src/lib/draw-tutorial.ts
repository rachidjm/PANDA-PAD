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
export const TUTORIAL_IMAGES: (string | null)[] = [null, null, null, null];

export const TUTORIAL_STEPS: DictKey[] = ["tutorial.step1", "tutorial.step2", "tutorial.step3", "tutorial.step4"];

/** It opens by itself only the first time the panel is opened; after that, only from its own button. */
export const shouldAutoShow = (panelOpen: boolean, seen: boolean) => panelOpen && !seen;

export type TutorialMove = "next" | "back";
/** Where a button takes you: the step to show, or "done" after the last one. Never before the first. */
export function moveStep(step: number, move: TutorialMove, total = TUTORIAL_STEPS.length): number | "done" {
  if (move === "back") return Math.max(0, step - 1);
  return step >= total - 1 ? "done" : step + 1;
}
