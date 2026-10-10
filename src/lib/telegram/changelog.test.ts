import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgGetChangelog, tgListChangelogs } from "@/lib/db/telegram";
import { POST as changelogRoute } from "@/app/api/telegram/changelog/route";
import { handleUpdate } from "./bot";
import { buildChangelogText, CB_DISCARD, CB_PUBLISH, changelogSecretMatches, checkChangelog, handleChangelogCallback, lineProblem, parseChangelogMarkdown, receiveDraft } from "./changelog";
import { ADMIN_TG, botDeps, queued, testConfig } from "./testing";

/**
 * The public changelog: its fixed format and content rules, the secret-protected endpoint, and the one thing that can
 * publish — an ADMIN pressing the button. On an in-memory Postgres; Telegram's API is a stub.
 */

const SECRET = "c".repeat(48);
const CHANNEL = "-1001";
const ENV = {
  FEATURE_TELEGRAM_BOT: "true",
  FEATURE_TELEGRAM_CHANGELOG: "true",
  CHANGELOG_PUBLISH_SECRET: SECRET,
  TELEGRAM_BOT_TOKEN: "123456:TEST-TOKEN-not-real-aaaaaaaaaaaaaaaaaaaaaa",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
  TELEGRAM_ADMIN_IDS: String(ADMIN_TG),
  TELEGRAM_CHANNEL_ID: CHANNEL,
  TELEGRAM_GROUP_URL: "https://t.me/pandacommunity",
  PANDA_STORAGE_MODES: "pause=postgres,sessions=postgres,audit=postgres",
};
let db: Db;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

before(async () => {
  db = await newTestDb();
  setDbForTests(db);
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).startsWith("https://api.telegram.org/")) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { "Content-Type": "application/json" } });
    throw new Error("unexpected network call in a test");
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

const NOW = Date.UTC(2026, 9, 10, 12);
const GOOD = { new: ["See what you hold of each coin, right on its page."], fixed: ["Buying no longer shows an error when the purchase went through."] };
const post = (body: unknown, auth?: string) =>
  new Request("https://launchonpanda.app/api/telegram/changelog", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const press = (id: number, data: string, from: number) => ({ update_id: id, callback_query: { id: `cb${id}`, data, from: { id: from, language_code: "es" }, message: { message_id: 5, chat: { id: from, type: "private" } } } });
let updateId = 900_000;
const channelPosts = async () => (await queued(db, CHANNEL)).filter((m) => m.text.includes("PANDA Update"));
async function draft(input: unknown = GOOD) {
  const d = botDeps(db);
  const r = await receiveDraft(d, input);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { d, id: r.id, text: r.text };
}

// ── format and content rules ────────────────────────────────────────────────────────────────────────────────────────

test("the format is fixed: title with the date, only the sections that have something, the site at the end", () => {
  const c = checkChangelog({ new: ["One."], improved: [], fixed: ["Two.", "Three."] });
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(buildChangelogText(c.sections, NOW), "🛠 PANDA Update · October 10, 2026\n\n✨ New\n- One.\n🐛 Fixed\n- Two.\n- Three.\n\n🌐 launchonpanda.app");
});

test("at most 3 lines per section, short lines, and an empty draft is nothing to send", () => {
  const four = checkChangelog({ new: ["a", "b", "c", "d"] });
  assert.ok(!four.ok && /at most 3/.test(four.problems.join()));
  const long = checkChangelog({ fixed: ["x".repeat(141)] });
  assert.ok(!long.ok && /140 characters/.test(long.problems.join()));
  assert.equal(checkChangelog({}).ok, false);
  assert.equal(checkChangelog({ new: [] }).ok, false);
  assert.equal(checkChangelog({ new: "not a list" }).ok, false);
});

test("forbidden content is refused, line by line: addresses, variables, secrets, files, /admin, infrastructure, security detail, private features, promises", () => {
  const bad: [string, RegExp][] = [
    ["Fees now go to 35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh.", /wallet address/],
    ["Added CHANGELOG_PUBLISH_SECRET to the settings.", /variable or secret/],
    ["Rotated the API key used for prices.", /secrets or credentials/],
    ["Refactored useDrawTrade.ts for speed.", /code or a file/],
    ["New list of drafts in /admin.", /admin area/],
    ["Admins can now pause the bot.", /admin area/],
    ["Moved the database to a faster region.", /infrastructure/],
    ["The RPC is now rate limited.", /infrastructure/],
    ["Fixed an XSS in the coin description.", /security detail/],
    ["Security: sessions can no longer be replayed.", /security detail/],
    ["Change a PANDA order by dragging its line.", /isn't open to everyone/],
    ["Limit orders are coming soon.", /promise about the future/],
    ["Next week we will add staking.", /promise about the future/],
    ["Holders get an airdrop for trading.", /price or rewards/],
    ["See more at https://example.com/x", /a link/],
  ];
  for (const [line, why] of bad) {
    const p = lineProblem(line);
    assert.ok(p && why.test(p), `${line} → ${p}`);
    assert.equal(checkChangelog({ improved: [line] }).ok, false, line);
  }
  // …and what a normal user-facing line looks like goes through, including the one allowed security line.
  for (const ok of ["Security improvements", "See what you hold of each coin, right on its page.", "Pump.fun and PumpSwap coins load faster.", "The buy button now tells you what really happened on Solana."]) assert.equal(lineProblem(ok), null, ok);
});

test("a Markdown draft: section headings and '- ' lines; everything else is ignored", () => {
  const md = "# PANDA Update\n\nsome note\n\n## ✨ New\n- First thing.\n- Second thing.\n\n### Improved:\n* Faster charts.\n\nFixed\n- A bug.\n\n## Internal notes\n- never sent\n";
  assert.deepEqual(parseChangelogMarkdown(md), { new: ["First thing.", "Second thing."], improved: ["Faster charts."], fixed: ["A bug."] });
});

// ── the endpoint ────────────────────────────────────────────────────────────────────────────────────────────────────

test("endpoint: without the secret, or with a wrong one → 401, and nothing is stored or sent", async () => {
  const before = (await tgListChangelogs(db, 100)).length;
  assert.equal((await changelogRoute(post(GOOD))).status, 401);
  assert.equal((await changelogRoute(post(GOOD, "Bearer nope"))).status, 401);
  assert.equal((await changelogRoute(post(GOOD, `Bearer ${SECRET.slice(0, -1)}x`))).status, 401);
  assert.equal((await changelogRoute(post(GOOD, `Bearer ${"w".repeat(40)}`))).status, 401, "the webhook's secret is not this endpoint's secret");
  assert.equal((await tgListChangelogs(db, 100)).length, before);
  assert.equal(changelogSecretMatches(null, SECRET), false);
  assert.equal(changelogSecretMatches(`Bearer ${SECRET}`, null), false, "no secret configured → never");
});

test("endpoint: switched off with the flag (or without a secret) it doesn't exist → 404, even with the right secret", async () => {
  process.env.FEATURE_TELEGRAM_CHANGELOG = "false";
  try {
    assert.equal((await changelogRoute(post(GOOD, `Bearer ${SECRET}`))).status, 404);
  } finally {
    process.env.FEATURE_TELEGRAM_CHANGELOG = "true";
  }
  delete process.env.CHANGELOG_PUBLISH_SECRET;
  try {
    assert.equal((await changelogRoute(post(GOOD, "Bearer "))).status, 404);
  } finally {
    process.env.CHANGELOG_PUBLISH_SECRET = SECRET;
  }
});

test("endpoint: a draft with forbidden data → 422 with the reason, and it never reaches anyone", async () => {
  const before = (await tgListChangelogs(db, 100)).length;
  const dms = (await queued(db, ADMIN_TG)).length;
  const res = await changelogRoute(post({ fixed: ["Closed an exploit in the wallet 35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh."] }, `Bearer ${SECRET}`));
  assert.equal(res.status, 422);
  const body = (await res.json()) as { problems: string[] };
  assert.ok(body.problems.length === 1 && /can't be published/.test(body.problems[0]));
  assert.equal((await changelogRoute(post("{not json", `Bearer ${SECRET}`))).status, 400);
  assert.equal((await changelogRoute(post({ new: ["x".repeat(9000)] }, `Bearer ${SECRET}`))).status, 413);
  assert.equal((await tgListChangelogs(db, 100)).length, before);
  assert.equal((await queued(db, ADMIN_TG)).length, dms);
});

test("endpoint: a good draft is stored as PENDING and goes to the admin in PRIVATE with the two buttons — not to the channel", async () => {
  const posts = (await channelPosts()).length;
  const res = await changelogRoute(post(GOOD, `Bearer ${SECRET}`));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string; sentTo: number; text: string };
  assert.equal(body.sentTo, 1);
  const row = await tgGetChangelog(db, body.id);
  assert.equal(row?.status, "pending");
  assert.ok(row!.text.startsWith("🛠 PANDA Update · ") && row!.text.endsWith("🌐 launchonpanda.app"));
  const dm = (await queued(db, ADMIN_TG)).at(-1)!;
  assert.ok(dm.text.includes("not published yet") && dm.text.includes("See what you hold"));
  const keys = (dm.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0];
  assert.deepEqual(keys.map((k) => k.text), ["✅ Publicar", "❌ Descartar"]);
  assert.deepEqual(keys.map((k) => k.callback_data), [`${CB_PUBLISH}${body.id}`, `${CB_DISCARD}${body.id}`]);
  assert.equal((await channelPosts()).length, posts, "nothing is published by sending a draft");
});

test("a draft is refused while there is nobody to approve it or nowhere to publish it", async () => {
  const noAdmin = await receiveDraft(botDeps(db, { cfg: testConfig({ adminIds: new Set() }) }), GOOD);
  assert.equal(noAdmin.ok === false && noAdmin.status, 503);
  const noChannel = await receiveDraft(botDeps(db, { cfg: testConfig({ channelId: null }) }), GOOD);
  assert.equal(noChannel.ok === false && noChannel.status, 503);
  const off = await receiveDraft(botDeps(db, { cfg: testConfig({ changelogEnabled: false }) }), GOOD);
  assert.equal(off.ok === false && off.status, 404);
});

// ── the buttons ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("a button pressed by someone who is NOT an admin does nothing: still pending, nothing in the channel", async () => {
  const { d, id } = await draft();
  const posts = (await channelPosts()).length;
  const stranger = 424242;
  const toasts: (string | undefined)[] = [];
  const deps = { ...d, answerCallback: async (_id: string, text?: string) => void toasts.push(text) };
  assert.equal(await handleUpdate(deps, press(++updateId, `${CB_PUBLISH}${id}`, stranger)), "ignored");
  assert.equal(await handleUpdate(deps, press(++updateId, `${CB_DISCARD}${id}`, stranger)), "ignored");
  assert.equal((await tgGetChangelog(db, id))?.status, "pending");
  assert.equal((await channelPosts()).length, posts);
  assert.equal((await queued(db, stranger)).length, 0);
  assert.deepEqual(toasts, ["Only a PANDA admin can do this.", "Only a PANDA admin can do this."]);
  assert.deepEqual(d.audits, []);
});

test("an admin presses ✅ Publicar: the exact draft goes to the channel with 'Discuss in Community' — once, however many presses", async () => {
  const { d, id, text } = await draft();
  const posts = (await channelPosts()).length;
  assert.equal(await handleUpdate(d, press(++updateId, `${CB_PUBLISH}${id}`, ADMIN_TG)), "handled");
  const row = await tgGetChangelog(db, id);
  assert.equal(row?.status, "published");
  assert.equal(row?.decidedBy, ADMIN_TG);
  const after = await channelPosts();
  assert.equal(after.length, posts + 1);
  const post1 = after.at(-1)!;
  assert.equal(post1.text, text);
  assert.deepEqual((post1.payload.reply_markup as { inline_keyboard: { text: string; url: string }[][] }).inline_keyboard, [[{ text: "💬 Discuss in Community", url: "https://t.me/pandacommunity" }]]);
  assert.ok((await queued(db, ADMIN_TG)).at(-1)!.text.includes("Published"));
  // A second press (or another admin's), and a late "Descartar": nothing more happens.
  const again = await handleChangelogCallback(d, { data: `${CB_PUBLISH}${id}`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.deepEqual([again.outcome, again.toast], ["already", "Already published."]);
  const late = await handleChangelogCallback(d, { data: `${CB_DISCARD}${id}`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.equal(late.outcome, "already");
  assert.equal((await tgGetChangelog(db, id))?.status, "published");
  assert.equal((await channelPosts()).length, posts + 1);
  assert.deepEqual(d.audits, ["telegram.changelog.publish"]);
});

test("an admin presses ❌ Descartar: it is marked discarded and can never be published afterwards", async () => {
  const { d, id } = await draft();
  const posts = (await channelPosts()).length;
  assert.equal(await handleUpdate(d, press(++updateId, `${CB_DISCARD}${id}`, ADMIN_TG)), "handled");
  assert.equal((await tgGetChangelog(db, id))?.status, "discarded");
  const tryPublish = await handleChangelogCallback(d, { data: `${CB_PUBLISH}${id}`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.deepEqual([tryPublish.outcome, tryPublish.toast], ["already", "Already discarded."]);
  assert.equal((await channelPosts()).length, posts);
  assert.ok((await queued(db, ADMIN_TG)).at(-1)!.text.includes("Nothing was published"));
});

test("an unknown or malformed draft id, or the changelog switched off, publishes nothing — even for an admin", async () => {
  const { d, id } = await draft();
  const posts = (await channelPosts()).length;
  for (const data of [`${CB_PUBLISH}0000000000000000`, `${CB_PUBLISH}zz`, `${CB_PUBLISH}`]) {
    assert.equal((await handleChangelogCallback(d, { data, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "unknown");
  }
  const off = await handleChangelogCallback({ ...d, cfg: testConfig({ changelogEnabled: false }) }, { data: `${CB_PUBLISH}${id}`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.equal(off.outcome, "off");
  assert.equal((await tgGetChangelog(db, id))?.status, "pending");
  assert.equal((await channelPosts()).length, posts);
});
