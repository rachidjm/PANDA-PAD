import { createHash } from "node:crypto";
import { asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "./client";
import { auditAnchors, auditEvents } from "./schema";
import type { AuditEvent } from "@/lib/audit/log";

/**
 * The audit trail as a hash chain in Postgres (phase 6, point 3).
 *
 *   hash(n) = sha256( hash(n-1) ‖ "\n" ‖ canonicalJSON(event n) )        hash(0) = 64 zeros ("genesis")
 *
 * Appends are serialized by an advisory lock, so the chain can't fork. `verifyChain` re-derives every hash and stops at the first
 * row that doesn't match — an edited event, a deleted one, or a reordered one. Anchors (the head hash published in a Solana memo)
 * are checked too: a chain that was rewritten or cut short after an anchor no longer contains that anchor's hash.
 */

export const GENESIS_HASH = "0".repeat(64);

/** JSON with sorted keys and no `undefined`, so the same event always serializes to the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export type ChainedFields = Pick<AuditEvent, "id" | "ts" | "actor" | "action" | "object" | "requestId"> & { oldState?: unknown; newState?: unknown; reason?: string | null };

export function eventHash(prevHash: string, e: ChainedFields): string {
  const body = canonicalJson({
    id: e.id,
    ts: e.ts,
    actor: e.actor,
    action: e.action,
    object: e.object,
    oldState: e.oldState ?? null,
    newState: e.newState ?? null,
    reason: e.reason ?? null,
    requestId: e.requestId,
  });
  return createHash("sha256").update(`${prevHash}\n${body}`).digest("hex");
}

/** Appends one event to the chain. "duplicate" (nothing written) if this event id is already in it. */
export async function pgAppendAudit(db: Db, e: AuditEvent): Promise<{ seq: number; hash: string } | "duplicate"> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('panda_audit_chain'))`);
    const [seen] = await tx.select({ seq: auditEvents.seq }).from(auditEvents).where(eq(auditEvents.eventId, e.id));
    if (seen) return "duplicate";
    const [last] = await tx.select({ hash: auditEvents.hash }).from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1);
    const prevHash = last?.hash ?? GENESIS_HASH;
    const hash = eventHash(prevHash, e);
    const [row] = await tx
      .insert(auditEvents)
      .values({
        eventId: e.id,
        ts: e.ts,
        actor: e.actor,
        action: e.action,
        object: e.object,
        oldState: e.oldState ?? null,
        newState: e.newState ?? null,
        reason: e.reason ?? null,
        requestId: e.requestId,
        prevHash,
        hash,
      })
      .returning({ seq: auditEvents.seq });
    return { seq: row.seq, hash };
  });
}

const toEvent = (r: typeof auditEvents.$inferSelect): AuditEvent => ({
  id: r.eventId,
  ts: r.ts,
  actor: r.actor,
  action: r.action,
  object: r.object,
  ...(r.oldState !== null ? { oldState: r.oldState } : {}),
  ...(r.newState !== null ? { newState: r.newState } : {}),
  ...(r.reason !== null ? { reason: r.reason } : {}),
  requestId: r.requestId,
});

/** Newest first. */
export async function pgListAudit(db: Db, limit: number): Promise<AuditEvent[]> {
  const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.seq)).limit(Math.min(Math.max(1, Math.floor(limit)), 100));
  return rows.map(toEvent);
}

export async function pgAuditHead(db: Db): Promise<{ seq: number; hash: string; length: number } | null> {
  const [last] = await db.select({ seq: auditEvents.seq, hash: auditEvents.hash }).from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1);
  if (!last) return null;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(auditEvents);
  return { ...last, length: Number(n) };
}

export type ChainVerdict = { ok: boolean; checked: number; head: { seq: number; hash: string } | null; problem?: { seq: number | null; reason: string } };

/** Re-derives the whole chain (and checks every anchor). Read-only. Stops at the first problem and says where. */
export async function pgVerifyChain(db: Db): Promise<ChainVerdict> {
  let expectedPrev = GENESIS_HASH;
  let checked = 0;
  let head: ChainVerdict["head"] = null;
  let afterSeq = 0;
  const hashAt = new Map<number, string>();
  const anchors = await db.select().from(auditAnchors).orderBy(asc(auditAnchors.headSeq));
  const wanted = new Set(anchors.map((a) => a.headSeq));
  for (;;) {
    const page = await db.select().from(auditEvents).where(gt(auditEvents.seq, afterSeq)).orderBy(asc(auditEvents.seq)).limit(1000);
    if (page.length === 0) break;
    for (const r of page) {
      if (r.prevHash !== expectedPrev) return { ok: false, checked, head, problem: { seq: r.seq, reason: "prev_hash does not match the previous event (an event was removed, inserted or reordered)" } };
      const again = eventHash(r.prevHash, toEvent(r));
      if (again !== r.hash) return { ok: false, checked, head, problem: { seq: r.seq, reason: "the event's content no longer matches its hash (it was edited)" } };
      expectedPrev = r.hash;
      head = { seq: r.seq, hash: r.hash };
      if (wanted.has(r.seq)) hashAt.set(r.seq, r.hash);
      checked++;
      afterSeq = r.seq;
    }
  }
  for (const a of anchors) {
    if (hashAt.get(a.headSeq) !== a.headHash) return { ok: false, checked, head, problem: { seq: a.headSeq, reason: "an anchor published on Solana no longer matches the chain (it was rewritten or cut short)" } };
  }
  return { ok: true, checked, head };
}

export async function pgRecordAnchor(db: Db, a: { headSeq: number; headHash: string; signature: string; wallet: string }): Promise<void> {
  await db.insert(auditAnchors).values(a).onConflictDoNothing();
}

export async function pgListAnchors(db: Db, limit = 20) {
  return db.select().from(auditAnchors).orderBy(desc(auditAnchors.id)).limit(limit);
}

/** Imports events from Blob in chronological order (ids are time-prefixed). Events already in the chain are skipped. Returns how many were added. */
export async function pgImportAudit(db: Db, events: AuditEvent[]): Promise<number> {
  const ordered = [...events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  let added = 0;
  for (const e of ordered) if ((await pgAppendAudit(db, e)) !== "duplicate") added++;
  return added;
}
