import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgGetChangelog, tgListChangelogs } from "@/lib/db/telegram";
import { POST as changelogRoute } from "@/app/api/telegram/changelog/route";
import { handleUpdate } from "./bot";
import {
  approvalMessage,
  buildChangelogText,
  CB_DISCARD,
  CB_EDIT,
  CB_PUBLISH,
  CB_VERSION,
  changelogSecretMatches,
  checkChangelog,
  checkDraft,
  EDIT_TTL_MS,
  handleChangelogCallback,
  lineProblem,
  parseChangelogMarkdown,
  parseDraftMarkdown,
  receiveDraft,
  checkSummary,
  buildExplanationText,
} from "./changelog";
import { ADMIN_TG, botDeps, queued, testConfig } from "./testing";

/**
 * The public changelog: its fixed format and content rules, the secret-protected endpoint, the approval message with its
 * three versions (+ translation, + the admin's own), and the one thing that can publish — an ADMIN pressing the button.
 * On an in-memory Postgres; Telegram's API is a stub.
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
/** Three really different versions; each Spanish line carries a marker so a leak into the channel would be seen. */
const GOOD = {
  level: "important",
  digest: "your holdings on every coin page",
  versions: [
    { new: ["See what you hold of each coin, right on its page."], fixed: ["Buying no longer shows an error when the purchase went through."], es: { summary: "TRAD-1 Cuenta que ahora ves cuántas monedas tienes y que comprar ya no da un error falso." } },
    { new: ["Your balance of a coin now sits above the trade box."], fixed: ["No more false errors after a buy that worked."], es: { summary: "TRAD-2 Dice lo mismo con otras palabras: tu saldo se ve arriba y se acabaron los errores falsos.", tone: "TRAD-2 cercano" } },
    { new: ["Open a coin and your holdings are right there."], fixed: ["A finished buy is shown as finished."], es: "TRAD-3 Al abrir una moneda ves lo que tienes. Una compra hecha se muestra como hecha." },
  ],
  x: [
    { text: "You can now see how much of a coin you hold right on its page. Buying also stopped showing an error when the purchase had gone through.", es: { summary: "XTRAD-1 Cuenta en dos frases que ves tu saldo y que comprar ya no da un error falso." } },
    { text: "Small one today. Your balance of each coin shows above the trade box, and a buy that worked no longer looks like it failed.", es: { summary: "XTRAD-2 Lo mismo, más informal.", tone: "cercano" } },
    { text: "Open a coin on PANDA and your holdings are there. A finished buy is shown as finished.", es: "XTRAD-3 Versión muy corta de lo mismo." },
  ],
};
/** The last draft of one place the admin got in private. */
const lastDraft = async (label = "📢 TELEGRAM") => (await queued(db, ADMIN_TG)).filter((m) => m.text.startsWith(`<b>${label} · Borrador</b>`)).at(-1)!;
const post = (body: unknown, auth?: string) =>
  new Request("https://launchonpanda.app/api/telegram/changelog", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const DRAFT_MESSAGE = 77;
const press = (id: number, data: string, from: number) => ({ update_id: id, callback_query: { id: `cb${id}`, data, from: { id: from, language_code: "es" }, message: { message_id: DRAFT_MESSAGE, chat: { id: from, type: "private" } } } });
const answer = (id: number, text: string, from: number, replyTo: number | null = 500) => ({
  update_id: id,
  message: { message_id: 900 + id, chat: { id: from, type: "private" }, from: { id: from, language_code: "es" }, text, ...(replyTo === null ? {} : { reply_to_message: { message_id: replyTo } }) },
});
let updateId = 900_000;
const channelPosts = async () => (await queued(db, CHANNEL)).filter((m) => m.text.includes("PANDA Update"));
type Edit = { chatId: number; messageId: number; payload: Record<string, unknown> };
type Keyboard = { text: string; callback_data: string }[][];
const keyboard = (payload: Record<string, unknown>) => (payload.reply_markup as { inline_keyboard: Keyboard }).inline_keyboard;

/** A stored draft plus bot deps that record every in-place edit of a message and every toast. */
async function draft(input: unknown = GOOD) {
  const edits: Edit[] = [];
  const toasts: (string | undefined)[] = [];
  const d = botDeps(db, {
    editMessage: async (chatId, messageId, payload) => void edits.push({ chatId, messageId, payload }),
    answerCallback: async (_id, text) => void toasts.push(text),
  });
  const r = await receiveDraft(d, input);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { d, id: r.id, versions: r.versions, edits, toasts };
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
    ["Orders are pre-signed with a durable nonce.", /works inside/],
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

test("a draft is exactly 3 versions, each within the rules, each with its very plain Spanish summary, and really different", () => {
  assert.equal(checkDraft(GOOD).ok, true);
  const problems = (input: unknown) => {
    const r = checkDraft(input);
    return r.ok ? "" : r.problems.join(" | ");
  };
  const [v1, v2, v3] = GOOD.versions;
  assert.match(problems({ versions: GOOD.versions.slice(0, 2) }), /exactly 3 versions \(got 2\)/);
  assert.match(problems({ new: ["Only one."] }), /exactly 3 versions/);
  assert.match(problems({ versions: [v1, v2, { ...v3, fixed: ["Closed an exploit."] }] }), /Version 3 · .*security detail/);
  // The summary: there must be one; one or two easy sentences; no list; nothing technical; the tone in a word or two.
  assert.match(problems({ versions: [v1, v2, { new: ["No summary here."] }] }), /Version 3 · the Spanish summary \("En resumen"\) is missing/);
  assert.match(problems({ versions: [v1, v2, { ...v3, es: "Una. Dos. Tres frases son demasiadas." }] }), /2 sentences at most/);
  assert.match(problems({ versions: [v1, v2, { ...v3, es: "- Esto es una lista. - Y no vale." }] }), /not a list/);
  assert.match(problems({ versions: [v1, v2, { ...v3, es: "Se cambió useDrawTrade.ts para que vaya más rápido." }] }), /files, functions or settings/);
  assert.match(problems({ versions: [v1, v2, { ...v3, es: "x".repeat(321) }] }), /too long/);
  assert.match(problems({ versions: [v1, v2, { ...v3, es: { summary: "Dice que hay una novedad.", tone: "muy cercano y con bastante humor" } }] }), /tone must be a word or two/);
  assert.equal(checkDraft({ versions: [v1, v2, { ...v3, es: { summary: "🇪🇸 En resumen: dice que hay una novedad.", tone: "Tono: directo." } }] }).ok, true, "labels written by hand are tolerated");
  assert.match(problems({ versions: [v1, v2, { ...v1, es: v3.es }] }), /Two versions are the same/);
  assert.deepEqual(checkSummary({ summary: "  En resumen:  Anuncia   una novedad.  ", tone: "tono: directo" }), { ok: true, value: { summary: "Anuncia una novedad.", tone: "directo" } });
  assert.equal(buildExplanationText("Anuncia una novedad.", "directo"), "Anuncia una novedad.\nTono: directo");
  assert.equal(buildExplanationText("Anuncia una novedad.", null), "Anuncia una novedad.");
});

test("a Markdown draft: level, digest and image on top; '# Version N' for Telegram and '# X N' for X; under each, '### ES' with the summary and an optional 'Tono:'", () => {
  assert.deepEqual(parseChangelogMarkdown("# PANDA Update\n\nnote\n\n## ✨ New\n- First.\n\n### Improved:\n* Faster charts.\n\nFixed\n- A bug.\n\n## Internal\n- never sent\n"), { new: ["First."], improved: ["Faster charts."], fixed: ["A bug."] });
  const md = [
    "intro, ignored",
    "Level: small",
    "Digest: faster charts",
    "Image: https://launchonpanda.app/a.png",
    "# Version 1", "## New", "- A thing.", "### ES", "Cuenta que hay", "una cosa nueva.",
    "# Versión 2", "## Fixed", "- A bug.", "## En resumen", "Dice que se arregló un fallo.", "", "Tono: cercano",
    "# Version 3", "## Improved", "- Faster.", "### ES", "Va más rápido.",
    "# X 1", "A thing is new.", "Second line.", "### ES", "Cuenta la novedad.", "Tono: directo",
    "# X 2", "Something else.", "### ES", "Otra forma de decirlo.",
  ].join("\n");
  assert.deepEqual(parseDraftMarkdown(md), {
    level: "small",
    digest: "faster charts",
    imageUrl: "https://launchonpanda.app/a.png",
    versions: [
      { new: ["A thing."], es: { summary: "Cuenta que hay una cosa nueva." } },
      { fixed: ["A bug."], es: { summary: "Dice que se arregló un fallo.", tone: "cercano" } },
      { improved: ["Faster."], es: { summary: "Va más rápido." } },
    ],
    x: [
      { text: "A thing is new.\nSecond line.", es: { summary: "Cuenta la novedad.", tone: "directo" } },
      { text: "Something else.", es: { summary: "Otra forma de decirlo." } },
    ],
  });
  assert.equal(parseDraftMarkdown("Nivel: importante\n# Version 1\n## New\n- A.\n### ES\nUna.").level, "important");
  assert.equal(parseDraftMarkdown("# Version 1\n## New\n- A.\n### ES\nUna.").x, undefined);
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

test("endpoint: a draft with forbidden data in ANY version → 422 with the reason, and it never reaches anyone", async () => {
  const before = (await tgListChangelogs(db, 100)).length;
  const dms = (await queued(db, ADMIN_TG)).length;
  const bad = { ...GOOD, versions: [GOOD.versions[0], { ...GOOD.versions[1], fixed: ["Closed an exploit in the wallet 35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh."] }, GOOD.versions[2]] };
  const res = await changelogRoute(post(bad, `Bearer ${SECRET}`));
  assert.equal(res.status, 422);
  const body = (await res.json()) as { problems: string[] };
  assert.ok(body.problems.length === 1 && /^Version 2 · .*can't be published/.test(body.problems[0]));
  assert.equal((await changelogRoute(post("{not json", `Bearer ${SECRET}`))).status, 400);
  assert.equal((await changelogRoute(post({ new: ["x".repeat(17000)] }, `Bearer ${SECRET}`))).status, 413);
  assert.equal((await tgListChangelogs(db, 100)).length, before);
  assert.equal((await queued(db, ADMIN_TG)).length, dms);
});

test("endpoint: a good draft is stored as PENDING with its 3 versions and goes to the admin in PRIVATE — not to the channel", async () => {
  const posts = (await channelPosts()).length;
  const res = await changelogRoute(post(GOOD, `Bearer ${SECRET}`));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string; xId: string; deferred: boolean; sentTo: number; versions: number; xVersions: number };
  assert.deepEqual([body.sentTo, body.versions, body.xVersions, body.deferred], [1, 3, 3, false]);
  const row = await tgGetChangelog(db, body.id);
  assert.equal(row?.status, "pending");
  assert.equal(row?.kind, "changelog");
  assert.equal(row?.versions.length, 3);
  assert.ok(row!.versions.every((v) => v.en.startsWith("🛠 PANDA Update · ") && v.en.endsWith("🌐 launchonpanda.app") && v.es?.includes("TRAD-") && !v.en.includes("TRAD-")));
  assert.equal(row!.versions[0].es, "TRAD-1 Cuenta que ahora ves cuántas monedas tienes y que comprar ya no da un error falso.", "the summary as the admin will read it");
  assert.ok(row!.versions[1].es!.endsWith("\nTono: TRAD-2 cercano"), "the tone, when given, is the last line");
  assert.ok(!row!.versions[2].es!.includes("Tono:"));
  // …and its twin for X: its own row, its own three texts.
  const xRow = await tgGetChangelog(db, body.xId);
  assert.deepEqual([xRow?.status, xRow?.kind, xRow?.versions.length], ["pending", "x", 3]);
  assert.equal(xRow!.versions[0].en, GOOD.x[0].text);
  assert.deepEqual([(row!.meta as { pair?: string }).pair, (xRow!.meta as { pair?: string }).pair], [body.xId, body.id]);
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

// ── the approval message ────────────────────────────────────────────────────────────────────────────────────────────

test("the approval message starts with its place — '📢 TELEGRAM · Borrador' — then 'Versión 1/3', the English text and, apart and in italics, '🇪🇸 En resumen:'; buttons 1 2 3 🔄 / Editar / Publicar Descartar", async () => {
  const { id, versions } = await draft();
  const dm = await lastDraft();
  assert.ok(dm.text.startsWith("<b>📢 TELEGRAM · Borrador</b> · Versión 1/3\n\n🛠 PANDA Update"));
  const [english, summary] = dm.text.split("\n\n———\n");
  assert.ok(english.includes("See what you hold") && !english.includes("TRAD-"));
  assert.equal(summary, "<i>🇪🇸 En resumen: TRAD-1 Cuenta que ahora ves cuántas monedas tienes y que comprar ya no da un error falso.</i>");
  assert.ok((await approvalMessage({ id, versions, kind: "changelog", meta: {} }, 1)).text!.toString().endsWith("\nTono: TRAD-2 cercano</i>"), "the tone sits under the summary");
  const rows = keyboard(dm.payload);
  assert.deepEqual(rows.map((r) => r.map((b) => b.text)), [["• 1 •", "2", "3", "🔄"], ["✏️ Editar"], ["✅ Publicar", "❌ Descartar"]]);
  assert.deepEqual(rows[0].map((b) => b.callback_data), [`${CB_VERSION}${id}_0`, `${CB_VERSION}${id}_1`, `${CB_VERSION}${id}_2`, `${CB_VERSION}${id}_1`]);
  assert.equal(rows[2][0].callback_data, `${CB_PUBLISH}${id}_0`);
  // Version 3: marked, 🔄 wraps round to the first, and Publicar now points at version 3.
  const third = approvalMessage({ id, versions, kind: "changelog", meta: {} }, 2);
  assert.deepEqual(keyboard(third)[0].map((b) => b.text), ["1", "2", "• 3 •", "🔄"]);
  assert.equal(keyboard(third)[0][3].callback_data, `${CB_VERSION}${id}_0`);
  assert.equal(keyboard(third)[2][0].callback_data, `${CB_PUBLISH}${id}_2`);
  assert.ok(rows.flat().every((b) => /^[a-z0-9_]{1,40}$/.test(b.callback_data)), "every button fits what the webhook accepts");
});

test("switching version (2, 3, 🔄) rewrites the SAME message — no new message, nothing published, still pending", async () => {
  const { d, id, edits, toasts } = await draft();
  const dms = (await queued(db, ADMIN_TG)).length;
  const posts = (await channelPosts()).length;
  assert.equal(await handleUpdate(d, press(++updateId, `${CB_VERSION}${id}_1`, ADMIN_TG)), "handled");
  assert.equal(edits.length, 1);
  assert.deepEqual([edits[0].chatId, edits[0].messageId], [ADMIN_TG, DRAFT_MESSAGE]);
  const text = String(edits[0].payload.text);
  assert.ok(text.includes("Versión 2/3") && text.includes("Your balance of a coin") && text.includes("TRAD-2") && !text.includes("TRAD-1"));
  assert.deepEqual(keyboard(edits[0].payload)[0].map((b) => b.text), ["1", "• 2 •", "3", "🔄"]);
  // 🔄 on that message is "next" = version 3.
  await handleUpdate(d, press(++updateId, keyboard(edits[0].payload)[0][3].callback_data, ADMIN_TG));
  assert.ok(String(edits[1].payload.text).includes("Versión 3/3"));
  assert.deepEqual(toasts, ["Versión 2", "Versión 3"]);
  assert.equal((await handleChangelogCallback(d, { data: `${CB_VERSION}${id}_7`, fromId: ADMIN_TG, chatId: ADMIN_TG, messageId: DRAFT_MESSAGE })).outcome, "unknown");
  assert.equal((await queued(db, ADMIN_TG)).length, dms, "no new message");
  assert.equal((await channelPosts()).length, posts);
  assert.equal((await tgGetChangelog(db, id))?.status, "pending");
});

test("✅ Publicar publishes the version THAT message shows — its English text only: the translation never reaches the channel", async () => {
  const { d, id, versions, edits } = await draft();
  const posts = (await channelPosts()).length;
  await handleUpdate(d, press(++updateId, `${CB_VERSION}${id}_1`, ADMIN_TG));
  const publish = keyboard(edits[0].payload)[2][0];
  assert.equal(publish.text, "✅ Publicar");
  assert.equal(await handleUpdate(d, press(++updateId, publish.callback_data, ADMIN_TG)), "handled");
  const row = await tgGetChangelog(db, id);
  assert.deepEqual([row?.status, row?.publishedVersion, row?.decidedBy], ["published", 1, ADMIN_TG]);
  assert.equal(row?.text, versions[1].en, "what was published is what is kept");
  const after = await channelPosts();
  assert.equal(after.length, posts + 1);
  const out = after.at(-1)!;
  assert.equal(out.text, versions[1].en);
  assert.deepEqual((out.payload.reply_markup as { inline_keyboard: { text: string; url: string }[][] }).inline_keyboard, [[{ text: "💬 Discuss in Community", url: "https://t.me/pandacommunity" }]]);
  // Nothing Spanish anywhere in what the channel got — not the translation, not its label.
  const everything = JSON.stringify((await queued(db, CHANNEL)).map((m) => m.payload));
  for (const leak of ["TRAD-", "En resumen", "Tono", "🇪🇸", "Versión", "Borrador", "TELEGRAM"]) assert.ok(!everything.includes(leak), leak);
  // The approval message loses its buttons and says what happened.
  const last = edits.at(-1)!;
  assert.ok(String(last.payload.text).startsWith("<b>✅ TELEGRAM · Publicado · versión 2</b>") && last.payload.reply_markup === undefined && !String(last.payload.text).includes("TRAD-"));
  assert.deepEqual(d.audits, ["telegram.changelog.publish"]);
});

test("a draft is decided ONCE: more presses (publish another version, discard, switch, edit) change nothing", async () => {
  const { d, id } = await draft();
  await handleUpdate(d, press(++updateId, `${CB_PUBLISH}${id}_0`, ADMIN_TG));
  const posts = (await channelPosts()).length;
  for (const data of [`${CB_PUBLISH}${id}_2`, `${CB_PUBLISH}${id}_0`, `${CB_DISCARD}${id}`, `${CB_VERSION}${id}_1`, `${CB_EDIT}${id}`]) {
    const r = await handleChangelogCallback(d, { data, fromId: ADMIN_TG, chatId: ADMIN_TG, messageId: DRAFT_MESSAGE });
    assert.deepEqual([r.outcome, r.toast], ["already", "Ya está publicado."], data);
  }
  assert.equal((await channelPosts()).length, posts);
  assert.equal((await tgGetChangelog(db, id))?.publishedVersion, 0);
});

test("❌ Descartar: marked discarded, nothing published, and it can never be published afterwards", async () => {
  const { d, id, edits } = await draft();
  const posts = (await channelPosts()).length;
  assert.equal(await handleUpdate(d, press(++updateId, `${CB_DISCARD}${id}`, ADMIN_TG)), "handled");
  assert.equal((await tgGetChangelog(db, id))?.status, "discarded");
  assert.ok(String(edits.at(-1)!.payload.text).startsWith("<b>❌ TELEGRAM · Descartado"));
  const tryPublish = await handleChangelogCallback(d, { data: `${CB_PUBLISH}${id}_1`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.deepEqual([tryPublish.outcome, tryPublish.toast], ["already", "Ya está descartado."]);
  assert.equal((await channelPosts()).length, posts);
});

test("EVERY button pressed by someone who is NOT an admin does nothing: no edit, no state, still pending, nothing in the channel", async () => {
  const { d, id, edits, toasts } = await draft();
  const posts = (await channelPosts()).length;
  const stranger = 424242;
  for (const data of [`${CB_VERSION}${id}_1`, `${CB_EDIT}${id}`, `${CB_PUBLISH}${id}_0`, `${CB_PUBLISH}${id}_2`, `${CB_DISCARD}${id}`]) {
    assert.equal(await handleUpdate(d, press(++updateId, data, stranger)), "ignored", data);
  }
  // …and a "reply with my text" from them is just an ordinary message, never a version.
  await handleUpdate(d, answer(++updateId, "✨ New\n- Sneaky line.", stranger));
  const row = await tgGetChangelog(db, id);
  assert.deepEqual([row?.status, row?.versions.length], ["pending", 3]);
  assert.equal(edits.length, 0);
  assert.equal((await channelPosts()).length, posts);
  assert.ok(toasts.length === 5 && toasts.every((x) => x === "Solo un admin de PANDA puede hacer esto."));
  assert.deepEqual(d.audits, []);
});

// ── ✏️ Editar ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("✏️ Editar: the bot asks for a reply; a text with forbidden content is refused saying WHAT, and nothing is added", async () => {
  const { d, id, edits } = await draft();
  assert.equal(await handleUpdate(d, press(++updateId, `${CB_EDIT}${id}`, ADMIN_TG)), "handled");
  const ask = (await queued(db, ADMIN_TG)).at(-1)!;
  assert.ok(ask.text.startsWith("✏️ Responde a este mensaje con tu texto"));
  assert.equal((ask.payload.reply_markup as { force_reply: boolean }).force_reply, true);
  await handleUpdate(d, answer(++updateId, "✨ New\n- Good line.\n🐛 Fixed\n- Closed an exploit.\n- Staking is coming soon.", ADMIN_TG));
  const no = (await queued(db, ADMIN_TG)).at(-1)!.text;
  assert.ok(no.startsWith("No se puede usar ese texto:"));
  assert.ok(/🐛 Fixed #1: .*security detail/.test(no) && /🐛 Fixed #2: .*promise about the future/.test(no), no);
  // No sections at all → told how to write it. A text that isn't a reply isn't taken as an edit.
  await handleUpdate(d, answer(++updateId, "just make it nicer please", ADMIN_TG));
  assert.ok((await queued(db, ADMIN_TG)).at(-1)!.text.startsWith("No he encontrado ninguna sección"));
  assert.equal((await tgGetChangelog(db, id))?.versions.length, 3);
  assert.equal(edits.length, 0);
  // Still waiting: a corrected answer now goes through (next test covers what it becomes).
  await handleUpdate(d, answer(++updateId, "✨ New\n- Good line.", ADMIN_TG));
  assert.equal((await tgGetChangelog(db, id))?.versions.length, 4);
});

test("✏️ Editar: a valid text becomes version '4 · mía' (no translation), shown in the same message, and can be published", async () => {
  const { d, id, edits } = await draft();
  await handleUpdate(d, press(++updateId, `${CB_EDIT}${id}`, ADMIN_TG));
  // Without having pressed Editar for it, or not as a reply, a message is not an edit.
  await handleUpdate(d, answer(++updateId, "✨ New\n- Not a reply.", ADMIN_TG, null));
  assert.equal((await tgGetChangelog(db, id))?.versions.length, 3);
  const mine = "🛠 PANDA Update · whatever\n\n✨ New\n- My own wording for the balance line.\n🔧 Improved\n- Trades tell you what happened.\n\n🌐 launchonpanda.app";
  assert.equal(await handleUpdate(d, answer(++updateId, mine, ADMIN_TG)), "handled");
  const row = (await tgGetChangelog(db, id))!;
  assert.equal(row.versions.length, 4);
  assert.deepEqual([row.versions[3].mine, row.versions[3].es], [true, null]);
  assert.ok(row.versions[3].en.startsWith("🛠 PANDA Update · ") && row.versions[3].en.includes("- My own wording for the balance line.") && row.versions[3].en.endsWith("🌐 launchonpanda.app"), "put in the fixed format");
  const shown = edits.at(-1)!;
  assert.deepEqual([shown.chatId, shown.messageId], [ADMIN_TG, DRAFT_MESSAGE], "the draft's own message is rewritten");
  assert.ok(String(shown.payload.text).includes("Versión 4 · mía") && !String(shown.payload.text).includes("En resumen"));
  assert.deepEqual(keyboard(shown.payload)[0].map((b) => b.text), ["1", "2", "3", "• 4 · mía •", "🔄"]);
  assert.ok((await queued(db, ADMIN_TG)).at(-1)!.text.includes("«4 · mía»"));
  // Editing again replaces it (there is only ever one "mía").
  await handleUpdate(d, press(++updateId, `${CB_EDIT}${id}`, ADMIN_TG));
  await handleUpdate(d, answer(++updateId, "🐛 Fixed\n- Second attempt.", ADMIN_TG));
  assert.equal((await tgGetChangelog(db, id))?.versions.length, 4);
  // Publishing from that message publishes MY text.
  const posts = (await channelPosts()).length;
  await handleUpdate(d, press(++updateId, keyboard(edits.at(-1)!.payload)[2][0].callback_data, ADMIN_TG));
  const out = (await channelPosts()).at(-1)!;
  assert.equal((await channelPosts()).length, posts + 1);
  assert.ok(out.text.includes("- Second attempt.") && !out.text.includes("My own wording"));
  assert.equal((await tgGetChangelog(db, id))?.publishedVersion, 3);
});

test("✏️ Editar expires, and an ordinary reply from the admin is then handled as usual", async () => {
  const { d, id } = await draft();
  await handleUpdate(d, press(++updateId, `${CB_EDIT}${id}`, ADMIN_TG));
  d.clock.t += EDIT_TTL_MS + 1;
  await handleUpdate(d, answer(++updateId, "✨ New\n- Too late.", ADMIN_TG));
  assert.equal((await tgGetChangelog(db, id))?.versions.length, 3);
});

test("an unknown or malformed draft id, or the changelog switched off, does nothing — even for an admin", async () => {
  const { d, id } = await draft();
  const posts = (await channelPosts()).length;
  for (const data of [`${CB_PUBLISH}0000000000000000_0`, `${CB_PUBLISH}zz`, `${CB_PUBLISH}`, `${CB_VERSION}${id}_x`]) {
    assert.equal((await handleChangelogCallback(d, { data, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "unknown", data);
  }
  const off = await handleChangelogCallback({ ...d, cfg: testConfig({ changelogEnabled: false }) }, { data: `${CB_PUBLISH}${id}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.equal(off.outcome, "off");
  assert.equal((await tgGetChangelog(db, id))?.status, "pending");
  assert.equal((await channelPosts()).length, posts);
});

test("PANDA orders can be announced only once they are open to everyone", () => {
  const line = "PANDA orders are open to everyone: sells and stops on the chart.";
  const before = process.env.PANDA_ORDERS_ALLOWLIST;
  try {
    delete process.env.PANDA_ORDERS_ALLOWLIST;
    assert.match(lineProblem(line) ?? "", /isn't open to everyone/);
    process.env.PANDA_ORDERS_ALLOWLIST = "SomeWallet1,SomeWallet2";
    assert.match(lineProblem(line) ?? "", /isn't open to everyone/);
    process.env.PANDA_ORDERS_ALLOWLIST = " * ";
    assert.equal(lineProblem(line), null);
  } finally {
    if (before === undefined) delete process.env.PANDA_ORDERS_ALLOWLIST;
    else process.env.PANDA_ORDERS_ALLOWLIST = before;
  }
});
