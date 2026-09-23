import { addMetrics, RollupDelta } from "@/lib/economy/rollup";
import { appendEvent, sanitizeEvent } from "./journal";
import { ACTIVITY_CONFIG as C } from "./config";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgRecordActivity } from "@/lib/db/activity";
import type { StoredEvent } from "./types";

/**
 * Best-effort recording into the journal from the places that just verified something on-chain. A journal
 * failure is logged and swallowed: an activity line must never fail a trade, a claim or a distribution.
 *
 * `metrics` are the economy totals this event contributes (see lib/economy/rollup.ts). They are added only when
 * the event is NEWLY recorded, so recording the same transaction twice can't count it twice. If the day's journal
 * is full the event can't be told apart from a repeat, so it is counted as `dropped` (that day's totals become a
 * lower bound and the analytics page says so).
 *
 * Where it is written follows PANDA_STORAGE_MODES (src/lib/db/mode.ts). In Blob the event and its totals are separate writes,
 * so a crash between them can undercount by one event; in Postgres they are ONE transaction (src/lib/db/activity.ts).
 */
export async function recordActivity(event: StoredEvent, metrics?: RollupDelta): Promise<void> {
  try {
    const now = Date.now();
    const mode = storageMode("activity");
    const stamped = { ...event, verified: true };

    if (mode !== "postgres") {
      const result = await appendEvent(stamped, now);
      if (result === "invalid") console.error("[ACTIVITY] not recorded:", result, event.id);
      if (metrics) {
        if (result === "added") await addMetrics(event.ts, metrics);
        else if (result === "full") await addMetrics(event.ts, { dropped: 1 });
      }
    }

    if (mode !== "blob") {
      const clean = sanitizeEvent(stamped, now);
      if (!clean) {
        if (mode === "postgres") console.error("[ACTIVITY] not recorded: invalid", event.id);
        return;
      }
      const write = () => pgRecordActivity(getDb(), clean, metrics, now, C.journalDayCap);
      if (mode === "dual") await mirror("activity", event.id, write);
      else await write();
    }
  } catch (err) {
    console.error("[ACTIVITY] journal write failed", event.id, String(err));
  }
}
