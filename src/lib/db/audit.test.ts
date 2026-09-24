import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { asc, sql } from "drizzle-orm";
import type { Db } from "./client";
import { newTestDb } from "./testing";
import { GENESIS_HASH, canonicalJson, eventHash, pgAppendAudit, pgAuditHead, pgImportAudit, pgListAudit, pgRecordAnchor, pgVerifyChain } from "./audit";
import { auditEvents } from "./schema";
import type { AuditEvent } from "@/lib/audit/log";

let n = 0;
const ev = (extra: Partial<AuditEvent> = {}): AuditEvent => ({ id: `${String(1_750_000_000_000 + ++n).padStart(13, "0")}-${n.toString(16).padStart(12, "0")}`, ts: 1_750_000_000_000 + n, actor: "ADMIN", action: "protocol.pause", object: "claims", requestId: `req-${n}`, ...extra });

/** A fresh database per test so chains never interfere. */
const fresh = () => newTestDb();
const tamper = async (db: Db, fn: () => Promise<unknown>) => {
  await db.execute(sql`alter table audit_events disable trigger audit_events_no_update`);
  try {
    await fn();
  } finally {
    await db.execute(sql`alter table audit_events enable trigger audit_events_no_update`);
  }
};
test("canonical JSON: key order doesn't matter, undefined is dropped, arrays and unicode are stable", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, undefined, "é"], c: undefined } }), canonicalJson({ a: { c: undefined, d: [1, null, "é"] }, b: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
  assert.equal(canonicalJson(undefined), "null");
});

test("each event's hash is sha256(previous hash + event) and the first links to genesis — checked independently of the code under test", async () => {
  const d = await fresh();
  const e1 = ev({ newState: { z: 1, a: [1, 2] } }), e2 = ev({ reason: "because" });
  const a = await pgAppendAudit(d, e1);
  const b = await pgAppendAudit(d, e2);
  assert.ok(a !== "duplicate" && b !== "duplicate");
  const rows = await d.select().from(auditEvents).orderBy(asc(auditEvents.seq));
  assert.equal(rows[0].prevHash, GENESIS_HASH);
  assert.equal(rows[1].prevHash, rows[0].hash);
  const manual = createHash("sha256").update(`${GENESIS_HASH}\n{"action":"protocol.pause","actor":"ADMIN","id":"${e1.id}","newState":{"a":[1,2],"z":1},"object":"claims","oldState":null,"reason":null,"requestId":"${e1.requestId}","ts":${e1.ts}}`).digest("hex");
  assert.equal(rows[0].hash, manual);
  assert.equal(rows[1].hash, eventHash(rows[0].hash, e2));
  assert.deepEqual(await pgVerifyChain(d), { ok: true, checked: 2, head: { seq: rows[1].seq, hash: rows[1].hash } });
});

test("an empty chain verifies, and recording the same event id twice adds it once", async () => {
  const d = await fresh();
  assert.deepEqual(await pgVerifyChain(d), { ok: true, checked: 0, head: null });
  const e = ev();
  assert.notEqual(await pgAppendAudit(d, e), "duplicate");
  assert.equal(await pgAppendAudit(d, e), "duplicate");
  assert.equal((await pgAuditHead(d))?.length, 1);
});

test("THE DATABASE REFUSES to edit, delete or truncate the audit trail", async () => {
  const d = await fresh();
  await pgAppendAudit(d, ev());
  await assert.rejects(d.execute(sql`update audit_events set action = 'x'`), (e: unknown) => /append-only/.test(`${(e as Error).message} ${(e as { cause?: Error }).cause?.message}`));
  await assert.rejects(d.execute(sql`delete from audit_events`), (e: unknown) => /append-only/.test(`${(e as Error).message} ${(e as { cause?: Error }).cause?.message}`));
  await assert.rejects(d.execute(sql`truncate audit_events`), (e: unknown) => /append-only/.test(`${(e as Error).message} ${(e as { cause?: Error }).cause?.message}`));
  assert.equal((await pgVerifyChain(d)).ok, true);
});

test("TAMPER-EVIDENT: editing an event (with the trigger bypassed by an owner) is caught, and the verdict names the row", async () => {
  const d = await fresh();
  for (let i = 0; i < 5; i++) await pgAppendAudit(d, ev());
  const rows = await d.select().from(auditEvents).orderBy(asc(auditEvents.seq));
  await tamper(d, () => d.execute(sql`update audit_events set actor = 'someone-else' where seq = ${rows[2].seq}`));
  const v = await pgVerifyChain(d);
  assert.equal(v.ok, false);
  assert.equal(v.problem?.seq, rows[2].seq);
  assert.match(v.problem!.reason, /edited/);
  assert.equal(v.checked, 2, "the first two events were fine");
});

test("TAMPER-EVIDENT: removing an event from the middle is caught at the next row", async () => {
  const d = await fresh();
  for (let i = 0; i < 4; i++) await pgAppendAudit(d, ev());
  const rows = await d.select().from(auditEvents).orderBy(asc(auditEvents.seq));
  await tamper(d, () => d.execute(sql`delete from audit_events where seq = ${rows[1].seq}`));
  const v = await pgVerifyChain(d);
  assert.equal(v.ok, false);
  assert.equal(v.problem?.seq, rows[2].seq);
  assert.match(v.problem!.reason, /removed, inserted or reordered/);
});

test("ANCHORS catch what the chain alone can't: an owner who rewrites the events AND every later hash", async () => {
  const d = await fresh();
  for (let i = 0; i < 4; i++) await pgAppendAudit(d, ev());
  const head = (await pgAuditHead(d))!;
  await pgRecordAnchor(d, { headSeq: head.seq, headHash: head.hash, signature: "SIG" + "s".repeat(80), wallet: "ADMIN" });
  await pgAppendAudit(d, ev());
  assert.equal((await pgVerifyChain(d)).ok, true, "a normal chain with an anchor verifies");

  // Rewrite history consistently: change event #2 and recompute every hash after it.
  const rows = await d.select().from(auditEvents).orderBy(asc(auditEvents.seq));
  await tamper(d, async () => {
    let prev = rows[1].prevHash;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const changed = i === 1 ? { ...r, actor: "forged" } : r;
      const hash = eventHash(prev, { id: changed.eventId, ts: changed.ts, actor: changed.actor, action: changed.action, object: changed.object, oldState: changed.oldState, newState: changed.newState, reason: changed.reason, requestId: changed.requestId });
      await d.execute(sql`update audit_events set actor = ${changed.actor}, prev_hash = ${prev}, hash = ${hash} where seq = ${r.seq}`);
      prev = hash;
    }
  });
  const v = await pgVerifyChain(d);
  assert.equal(v.ok, false, "the chain is internally consistent again, but the anchor on Solana disagrees");
  assert.match(v.problem!.reason, /anchor/);
});

test("CONCURRENCY: 30 simultaneous events form one unbroken chain (no forks, no duplicates)", async () => {
  const d = await fresh();
  const results = await Promise.all(Array.from({ length: 30 }, () => pgAppendAudit(d, ev())));
  assert.ok(results.every((r) => r !== "duplicate"));
  const v = await pgVerifyChain(d);
  assert.equal(v.ok, true);
  assert.equal(v.checked, 30);
  const rows = await d.select().from(auditEvents);
  assert.equal(new Set(rows.map((r) => r.prevHash)).size, 30, "every event has a different predecessor: no fork");
});

test("complex states survive the JSON round trip through Postgres without changing the hash", async () => {
  const d = await fresh();
  await pgAppendAudit(d, ev({ oldState: { a: 1.5, b: [null, "ñ", { deep: true }], c: 12345678901234 }, newState: { "weird key": "línea\nnueva", empty: {}, arr: [] }, reason: "razón" }));
  assert.equal((await pgVerifyChain(d)).ok, true);
});

test("import puts Blob's history in chronological order, skips what is already there, and the result verifies", async () => {
  const d = await fresh();
  const late = ev(), early = ev({ ts: late.ts - 5_000, id: `0${String(late.ts - 5_000)}-aaaaaaaaaaaa` });
  assert.equal(await pgImportAudit(d, [late, early]), 2);
  assert.equal(await pgImportAudit(d, [early, late]), 0);
  const list = await pgListAudit(d, 10);
  assert.deepEqual(list.map((e) => e.id), [late.id, early.id], "newest first");
  assert.equal((await pgVerifyChain(d)).ok, true);
  assert.equal(list[1].oldState, undefined);
});
