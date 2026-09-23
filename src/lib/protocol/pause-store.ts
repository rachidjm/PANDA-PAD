import { readJson, updateJson } from "@/lib/rewards/blob-store";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgGetPauseState, pgSetPause } from "@/lib/db/pause";
import { applyPause, EMPTY_PAUSE_STATE, isPaused, PauseEntry, PauseState, Subsystem } from "./pause";

/**
 * Server-only storage for the pause switches — one small Blob JSON file,
 * updated with the same ETag-guarded read-modify-write as the rewards ledger.
 * Moving to a database later only means replacing this file.
 *
 * Reads are cached for a few seconds per server instance, so a pause reaches
 * every instance within ~CACHE_MS. Reads FAIL CLOSED: if the state can't be
 * read, the subsystem is treated as paused rather than assumed running.
 */

const PATH = "protocol/pause.json";
const CACHE_MS = 5_000;

let cache: { state: PauseState; at: number } | null = null;

/** Throws if the state can't be read. */
export async function getPauseState(): Promise<PauseState> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.state;
  const state = storageMode("pause") === "postgres" ? await pgGetPauseState(getDb()) : await readJson<PauseState>(PATH, EMPTY_PAUSE_STATE);
  cache = { state, at: Date.now() };
  return state;
}

/** Whether `subsystem` may run right now. Unreadable state counts as paused. */
export async function checkActive(subsystem: Subsystem): Promise<{ paused: boolean; reason: string }> {
  try {
    const state = await getPauseState();
    return { paused: isPaused(state, subsystem), reason: state.subsystems[subsystem]?.reason ?? "" };
  } catch {
    return { paused: true, reason: "Protocol status is unavailable — paused as a precaution." };
  }
}

export async function setPause(
  subsystem: Subsystem,
  paused: boolean,
  reason: string,
  by: string
): Promise<{ before: PauseEntry | null; after: PauseEntry | null; changed: boolean }> {
  const now = Date.now();
  if (storageMode("pause") === "postgres") {
    const r = await pgSetPause(getDb(), subsystem, paused, reason, by, now);
    cache = null;
    return r;
  }
  const result = await updateJson<PauseState, { before: PauseEntry | null; changed: boolean; next: PauseState }>(
    PATH,
    EMPTY_PAUSE_STATE,
    (current) => {
      const r = applyPause(current, subsystem, paused, reason, by, now);
      return { next: r.next, result: r };
    }
  );
  cache = null; // this instance sees its own change immediately
  if (storageMode("pause") === "dual") await mirror("pause", `${subsystem}=${paused}`, () => pgSetPause(getDb(), subsystem, paused, reason, by, now));
  return { before: result.before, after: result.next.subsystems[subsystem] ?? null, changed: result.changed };
}
