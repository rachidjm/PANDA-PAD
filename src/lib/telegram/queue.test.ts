import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgEnqueue, tgGetUser, tgTouchUser } from "@/lib/db/telegram";
import type { TelegramCall, TelegramResult } from "./api";
import { backoffMs, GROUP_PER_MINUTE, MAX_ATTEMPTS, processOutbox } from "./queue";
import { newUserId, queued } from "./testing";

let db: Db;
before(async () => {
  db = await newTestDb();
});

function harness(answer: (method: string, payload: Record<string, unknown>) => TelegramResult) {
  const clock = { t: 1_900_000_000_000 };
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const call: TelegramCall = async <T,>(method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    clock.t += 10;
    return answer(method, payload) as TelegramResult<T>;
  };
  return { clock, calls, deps: { db, call, now: () => clock.t, sleep: async (ms: number) => void (clock.t += ms) } };
}

const text = (chat: number | string, t: string, dedupeKey?: string) => ({ chatId: String(chat), method: "sendMessage" as const, payload: { text: t }, dedupeKey });

test("sends what's due and marks it sent; the same event (dedupe key) is queued only once", async () => {
  const u = newUserId();
  const h = harness(() => ({ ok: true, errorCode: 0 }));
  assert.notEqual(await tgEnqueue(db, text(u, "a", "evt:1"), h.clock.t), null);
  assert.equal(await tgEnqueue(db, text(u, "a again", "evt:1"), h.clock.t), null);
  const r = await processOutbox(h.deps, 5_000);
  assert.equal(r.sent, 1);
  assert.equal((await queued(db, u))[0].row.status, "sent");
  assert.equal(h.calls[0].payload.chat_id, String(u));
});

test("429: waits exactly Telegram's retry_after, without counting it as a failure", async () => {
  const u = newUserId();
  const h = harness(() => ({ ok: false, errorCode: 429, retryAfter: 7 }));
  await tgEnqueue(db, text(u, "x"), h.clock.t);
  const r = await processOutbox(h.deps, 5_000);
  assert.equal(r.retried, 1);
  const row = (await queued(db, u))[0].row;
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 0);
  assert.ok(row.nextAttemptAt >= h.clock.t - 20 + 7_000 - 100 && row.nextAttemptAt <= h.clock.t + 7_000);
});

test("network / 5xx: retried with growing waits, then given up after the last attempt", async () => {
  assert.deepEqual([1, 2, 3, 9].map(backoffMs), [15_000, 30_000, 60_000, 3_600_000]);
  const u = newUserId();
  const h = harness(() => ({ ok: false, errorCode: 0, description: "network error" }));
  await tgEnqueue(db, text(u, "x"), h.clock.t);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await processOutbox(h.deps, 5_000);
    h.clock.t += 3_700_000;
  }
  const row = (await queued(db, u))[0].row;
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, MAX_ATTEMPTS);
  assert.equal(h.calls.filter((c) => c.payload.chat_id === String(u)).length, MAX_ATTEMPTS);
});

test("403 in a private chat: the user blocked the bot — failed at once, and nothing more is queued for them", async () => {
  const u = newUserId();
  await tgTouchUser(db, u, "en", 1);
  const h = harness(() => ({ ok: false, errorCode: 403, description: "Forbidden: bot was blocked by the user" }));
  await tgEnqueue(db, text(u, "x"), h.clock.t);
  await processOutbox(h.deps, 5_000);
  assert.equal((await queued(db, u))[0].row.status, "failed");
  assert.equal((await tgGetUser(db, u))?.blocked, true);
});

test("a photo Telegram can't fetch is re-sent as text, so the post isn't lost", async () => {
  const h = harness((method) => (method === "sendPhoto" ? { ok: false, errorCode: 400, description: "Bad Request: wrong file identifier" } : { ok: true, errorCode: 0 }));
  await tgEnqueue(db, { chatId: "-1009", method: "sendPhoto", payload: { photo: "https://x/y.png", caption: "New coin" }, dedupeKey: "launch:abc" }, h.clock.t);
  await processOutbox(h.deps, 5_000);
  const q = await queued(db, "-1009");
  assert.equal(q[0].row.status, "failed");
  assert.equal(q[1].row.method, "sendMessage");
  assert.equal(q[1].text, "New coin");
  assert.equal(q[1].row.status, "sent");
});

test("pacing: one message a second to a private chat, 20 a minute to a group", async () => {
  const u = newUserId();
  const h = harness(() => ({ ok: true, errorCode: 0 }));
  await tgEnqueue(db, text(u, "1"), h.clock.t);
  await tgEnqueue(db, text(u, "2"), h.clock.t);
  const r = await processOutbox(h.deps, 200);
  assert.equal(r.sent, 1);
  assert.equal(r.deferred, 1, "the second waits a second");

  for (let i = 0; i < GROUP_PER_MINUTE + 3; i++) await tgEnqueue(db, text("-1007", `g${i}`), h.clock.t);
  await processOutbox(h.deps, 2_000);
  const sent = (await queued(db, "-1007")).filter((x) => x.row.status === "sent").length;
  assert.equal(sent, GROUP_PER_MINUTE);
});
