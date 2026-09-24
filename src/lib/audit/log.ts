import { randomBytes, randomUUID } from "node:crypto";
import { put, list } from "@vercel/blob";
import { blobConfigured, readJson, requireToken } from "@/lib/rewards/blob-store";
import { redact } from "./redact";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgAppendAudit, pgListAudit } from "@/lib/db/audit";
import { alertOps } from "@/lib/alerts";

/**
 * Append-only audit trail. Each event is its own immutable Blob file
 * (`audit/events/<day>/<id>.json`, never overwritten), so recording one can't
 * conflict with another and nothing ever edits history.
 *
 * Recording is best-effort by design: a failed audit write is logged loudly
 * but never blocks the action (an emergency pause must not be stoppable by a
 * storage hiccup). Blob files are readable by anyone holding the URL, so
 * events carry only what's safe to be public: wallet addresses, public
 * transaction signatures and state changes — never secrets (see ./redact.ts).
 */

export type AuditEvent = {
  id: string;
  ts: number;
  actor: string;
  action: string;
  object: string;
  oldState?: unknown;
  newState?: unknown;
  reason?: string;
  requestId: string;
};

export type AuditInput = {
  req?: Request | null;
  /** Who did it: a verified wallet, "system:cron", or "unauthenticated:<claimed wallet>". */
  actor: string;
  action: string;
  object: string;
  oldState?: unknown;
  newState?: unknown;
  reason?: string;
};

export function requestId(req?: Request | null): string {
  return req?.headers.get("x-vercel-id") || randomUUID();
}

// Time-sortable and unique: 13-digit ms timestamp + 48 random bits.
export const newEventId = (ts: number) => `${String(ts).padStart(13, "0")}-${randomBytes(6).toString("hex")}`;
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const pathFor = (e: Pick<AuditEvent, "id" | "ts">) => `audit/events/${day(e.ts)}/${e.id}.json`;

// Local development without a Blob store only.
const devEvents: AuditEvent[] = [];
const inDevMemoryMode = () => process.env.NODE_ENV !== "production" && !blobConfigured();

export function buildEvent(input: AuditInput, ts = Date.now()): AuditEvent {
  return {
    id: newEventId(ts),
    ts,
    actor: input.actor,
    action: input.action,
    object: input.object,
    oldState: redact(input.oldState),
    newState: redact(input.newState),
    reason: input.reason?.slice(0, 200),
    requestId: requestId(input.req),
  };
}

/**
 * Never throws. Where the event lands follows PANDA_STORAGE_MODES (audit): Vercel Blob (`blob`, one PUBLIC file per event — the original),
 * both (`dual`, Blob first, then the Postgres hash chain as a mirror), or the Postgres hash chain only (`postgres`: nothing public).
 * A failed write is logged and ALERTED but never blocks the action (an emergency pause must not be stoppable by a storage hiccup).
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const event = buildEvent(input);
  console.info("[PANDA AUDIT]", JSON.stringify(event)); // also lands in Vercel logs, independent of the database
  const mode = storageMode("audit");
  try {
    if (mode !== "postgres") {
      if (inDevMemoryMode()) devEvents.push(event);
      else {
        await put(pathFor(event), JSON.stringify(event), {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/json",
          token: requireToken(),
        });
      }
    }
    if (mode === "postgres") await pgAppendAudit(getDb(), event);
    else if (mode === "dual") await mirror("audit", event.id, () => pgAppendAudit(getDb(), event));
  } catch (err) {
    console.error("[PANDA AUDIT] failed to persist event", event.id, String(err));
    await alertOps("Audit event could NOT be persisted", { id: event.id, action: event.action, object: event.object });
  }
}

/** Newest first. Looks back up to `days` days. */
export async function listAudit(limit = 50, days = 7): Promise<AuditEvent[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit)), 100);
  if (storageMode("audit") === "postgres") return pgListAudit(getDb(), cap);
  if (inDevMemoryMode()) return [...devEvents].reverse().slice(0, cap);

  const out: AuditEvent[] = [];
  for (let i = 0; i < days && out.length < cap; i++) {
    const prefix = `audit/events/${day(Date.now() - i * 86_400_000)}/`;
    const { blobs } = await list({ prefix, limit: 1000, token: requireToken() });
    const paths = blobs.map((b) => b.pathname).sort().reverse().slice(0, cap - out.length);
    const events = await Promise.all(paths.map((p) => readJson<AuditEvent | null>(p, null).catch(() => null)));
    out.push(...events.filter((e): e is AuditEvent => e !== null));
  }
  return out;
}
