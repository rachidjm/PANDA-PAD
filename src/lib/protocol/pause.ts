/**
 * Emergency pause switches, one per subsystem so a problem in one area (say,
 * claims) doesn't have to take down another (token launches). Pure state
 * transitions live here; storage is in ./pause-store.ts.
 *
 * Pausing never deletes or rewrites anything — it only makes the affected
 * routes refuse new work while the reason stays visible to users.
 */

export const SUBSYSTEMS = [
  "claims",
  "airdrops",
  "nft_minting",
  "token_launches",
  "reward_calculations",
  "fee_processing",
] as const;

export type Subsystem = (typeof SUBSYSTEMS)[number];

export type PauseEntry = { paused: boolean; reason: string; since: number; by: string };
export type PauseState = { version: 1; subsystems: Partial<Record<Subsystem, PauseEntry>> };

export const EMPTY_PAUSE_STATE: PauseState = { version: 1, subsystems: {} };
export const MAX_REASON_LENGTH = 200;

export const isSubsystem = (v: unknown): v is Subsystem => typeof v === "string" && (SUBSYSTEMS as readonly string[]).includes(v);

/** The exact phrase an admin must send to confirm a change — deliberately not guessable by a stray request. */
export const confirmationPhrase = (paused: boolean, subsystem: Subsystem) => `${paused ? "PAUSE" : "RESUME"} ${subsystem}`;

export function validateReason(paused: boolean, reason: unknown): string | null {
  if (typeof reason !== "string") return paused ? "A reason is required to pause." : null;
  if (reason.length > MAX_REASON_LENGTH) return `Reason must be at most ${MAX_REASON_LENGTH} characters.`;
  if (paused && reason.trim().length < 3) return "A reason is required to pause.";
  return null;
}

export function isPaused(state: PauseState, subsystem: Subsystem): boolean {
  return state.subsystems[subsystem]?.paused === true;
}

/** Returns the new state (input untouched) and the entry it replaced, for the audit trail. */
export function applyPause(
  state: PauseState,
  subsystem: Subsystem,
  paused: boolean,
  reason: string,
  by: string,
  now: number
): { next: PauseState; before: PauseEntry | null; changed: boolean } {
  const before = state.subsystems[subsystem] ?? null;
  const changed = (before?.paused ?? false) !== paused;
  if (!changed) return { next: state, before, changed };
  const entry: PauseEntry = { paused, reason: reason.trim(), since: now, by };
  return { next: { ...state, subsystems: { ...state.subsystems, [subsystem]: entry } }, before, changed };
}
