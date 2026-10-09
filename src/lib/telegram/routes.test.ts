import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { GET as cron } from "@/app/api/cron/telegram/route";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/telegram/route";
import { POST as linkMessage } from "@/app/api/telegram/link/message/route";
import { POST as linkComplete } from "@/app/api/telegram/link/route";
import { queued } from "./testing";

/** The routes end to end, on an in-memory Postgres; Telegram's API is a stub (no network, no real token). */

const SECRET = "w".repeat(40);
const ENV = {
  FEATURE_TELEGRAM_BOT: "true",
  TELEGRAM_BOT_TOKEN: "123456:TEST-TOKEN-not-real-aaaaaaaaaaaaaaaaaaaaaa",
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_BOT_USERNAME: "PandaTestBot",
  PANDA_STORAGE_MODES: "pause=postgres,sessions=postgres",
  CRON_SECRET: "c".repeat(32),
};
let db: Db;
const saved: Record<string, string | undefined> = {};
const telegramCalls: string[] = [];
const realFetch = globalThis.fetch;

before(async () => {
  db = await newTestDb();
  setDbForTests(db);
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      telegramCalls.push(url.split("/").pop()!);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected network call in a test: ${url.slice(0, 40)}`);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setDbForTests(null);
});

const update = (id: number, text: string, from = 777) => ({ update_id: id, message: { message_id: 1, chat: { id: from, type: "private" }, from: { id: from, language_code: "en" }, text } });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://launchonpanda.app/api/telegram/webhook", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("webhook: no / wrong secret header → 401, and nothing is handled", async () => {
  assert.equal((await webhook(post(update(1, "/help")))).status, 401);
  assert.equal((await webhook(post(update(2, "/help"), { "x-telegram-bot-api-secret-token": "nope" }))).status, 401);
  assert.equal((await queued(db, 777)).length, 0);
});

test("webhook: bad JSON → 400, a malformed update → 400, an oversized body → 413", async () => {
  const h = { "x-telegram-bot-api-secret-token": SECRET };
  assert.equal((await webhook(post("{not json", h))).status, 400);
  assert.equal((await webhook(post({ hello: 1 }, h))).status, 400);
  assert.equal((await webhook(post({ update_id: 3, pad: "x".repeat(70_000) }, h))).status, 413);
});

test("webhook: a valid command is answered — queued, then sent through the (stubbed) Bot API at once", async () => {
  const res = await webhook(post(update(10, "/help"), { "x-telegram-bot-api-secret-token": SECRET }));
  assert.equal(res.status, 200);
  const q = await queued(db, 777);
  assert.equal(q.length, 1);
  assert.equal(q[0].row.status, "sent");
  assert.ok(telegramCalls.includes("sendMessage"));
});

test("webhook and link routes are switched off with the flag (404); the cron says so and does nothing", async () => {
  process.env.FEATURE_TELEGRAM_BOT = "false";
  try {
    assert.equal((await webhook(post(update(11, "/help"), { "x-telegram-bot-api-secret-token": SECRET }))).status, 404);
    assert.equal((await linkMessage(new Request("https://launchonpanda.app/x", { method: "POST", body: "{}" }))).status, 404);
    assert.equal((await linkComplete(new Request("https://launchonpanda.app/x", { method: "POST", body: "{}" }))).status, 404);
    const c = await cron(new Request("https://launchonpanda.app/api/cron/telegram", { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }));
    assert.deepEqual(await c.json(), { skipped: "flag off" });
  } finally {
    process.env.FEATURE_TELEGRAM_BOT = "true";
  }
});

test("cron without CRON_SECRET → 404", async () => {
  assert.equal((await cron(new Request("https://launchonpanda.app/api/cron/telegram"))).status, 404);
});

test("admin route: without an admin session it doesn't exist (404) — status, webhook, commands, announcements alike", async () => {
  assert.equal((await adminGet(new Request("https://launchonpanda.app/api/admin/telegram"))).status, 404);
  for (const action of ["set_webhook", "delete_webhook", "set_commands", "announce"]) {
    const r = await adminPost(new Request("https://launchonpanda.app/api/admin/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, text: "hi" }) }));
    assert.equal(r.status, 404, action);
  }
  assert.ok(!telegramCalls.includes("setWebhook"));
});

test("link routes: an unknown code is refused (410), garbage is 400, a cross-site request is 403", async () => {
  const body = (b: unknown, origin?: string) => new Request("https://launchonpanda.app/api/telegram/link", { method: "POST", headers: { "Content-Type": "application/json", host: "launchonpanda.app", ...(origin ? { origin } : {}) }, body: JSON.stringify(b) });
  assert.equal((await linkMessage(body({ code: "A".repeat(24), wallet: "35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh" }))).status, 410);
  assert.equal((await linkMessage(body({ code: "short", wallet: "x" }))).status, 400);
  assert.equal((await linkComplete(body({ code: "A".repeat(24) }, "https://evil.example"))).status, 403);
});
