/**
 * "Is there an update this visitor hasn't seen?" — decided in the browser, from the newest update's address and the one
 * remembered the last time /updates was opened. Pure, so it is tested; the storage itself is in useLatestUpdate.
 */

export const SEEN_KEY = "panda.updates.seen";
export const SEEN_EVENT = "panda:updates-seen";

/** A first-time visitor has seen nothing, so the newest update is new to them. No updates → nothing is new. */
export function hasUnseen(latestId: string | null | undefined, seenId: string | null | undefined): boolean {
  return !!latestId && latestId !== seenId;
}
