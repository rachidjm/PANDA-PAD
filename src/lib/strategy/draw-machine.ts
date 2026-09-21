/**
 * The drawing gesture as a tiny state machine, independent of React and of the DOM, so mouse and touch share
 * ONE behaviour instead of two implementations:
 *
 *   • mouse / pen: the line follows the pointer while it hovers; press + release on the chart sets the price.
 *   • touch: the line follows the finger while it is down (a finger can't hover); lifting sets the price. A
 *     plain tap is just "down, up" at the same spot.
 *
 * Nothing here places an order. Setting a price only records a number in a draft.
 */

export type DrawTarget = "buy" | "sell" | "stop";
export type DrawState = { target: DrawTarget | null; preview: number | null; armed: boolean };
export type PointerInfo = { type: string; button?: number };

export const IDLE: DrawState = { target: null, preview: null, armed: false };

export function start(target: DrawTarget): DrawState {
  return { target, preview: null, armed: false };
}

export function move(s: DrawState, price: number, p: PointerInfo & { pressed: boolean }): DrawState {
  if (!s.target) return s;
  if (p.type === "touch" && !p.pressed) return s;
  return { ...s, preview: price };
}

export function down(s: DrawState, price: number, p: PointerInfo): DrawState {
  if (!s.target) return s;
  if (p.type === "mouse" && p.button !== undefined && p.button !== 0) return s;
  return { ...s, preview: price, armed: true };
}

/** `picked` is the price the user confirmed, or null when this release isn't a confirmation. */
export function up(s: DrawState, price: number, p: PointerInfo): { state: DrawState; picked: number | null } {
  if (!s.target || !s.armed) return { state: s, picked: null };
  if (p.type === "mouse" && p.button !== undefined && p.button !== 0) return { state: s, picked: null };
  return { state: IDLE, picked: price };
}

/** The pointer left the chart or the browser took the gesture over (e.g. to scroll): nothing is confirmed. */
export function abort(s: DrawState): DrawState {
  return s.target ? { ...s, preview: null, armed: false } : s;
}

export function cancel(): DrawState {
  return IDLE;
}
