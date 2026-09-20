import { appendEvent } from "./journal";
import type { StoredEvent } from "./types";

/**
 * Best-effort recording into the journal from the places that just verified something on-chain. A journal
 * failure is logged and swallowed: an activity line must never fail a trade, a claim or a distribution.
 */
export async function recordActivity(event: StoredEvent): Promise<void> {
  try {
    const r = await appendEvent({ ...event, verified: true }, Date.now());
    if (r === "invalid" || r === "full") console.error("[ACTIVITY] not recorded:", r, event.id);
  } catch (err) {
    console.error("[ACTIVITY] journal write failed", event.id, String(err));
  }
}
