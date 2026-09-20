import { addMetrics, RollupDelta } from "@/lib/economy/rollup";
import { appendEvent } from "./journal";
import type { StoredEvent } from "./types";

/**
 * Best-effort recording into the journal from the places that just verified something on-chain. A journal
 * failure is logged and swallowed: an activity line must never fail a trade, a claim or a distribution.
 *
 * `metrics` are the economy totals this event contributes (see lib/economy/rollup.ts). They are added only when
 * the event is NEWLY recorded, so recording the same transaction twice can't count it twice. If the day's journal
 * is full the event can't be told apart from a repeat, so it is counted as `dropped` (that day's totals become a
 * lower bound and the analytics page says so). A crash between the two writes can also undercount by one event.
 */
export async function recordActivity(event: StoredEvent, metrics?: RollupDelta): Promise<void> {
  try {
    const now = Date.now();
    const result = await appendEvent({ ...event, verified: true }, now);
    if (result === "invalid") console.error("[ACTIVITY] not recorded:", result, event.id);
    if (!metrics) return;
    if (result === "added") await addMetrics(event.ts, metrics);
    else if (result === "full") await addMetrics(event.ts, { dropped: 1 });
  } catch (err) {
    console.error("[ACTIVITY] journal write failed", event.id, String(err));
  }
}
