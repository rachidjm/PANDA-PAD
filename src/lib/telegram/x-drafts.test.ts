import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgDeferredDrafts, tgGetChangelog, tgListChangelogs } from "@/lib/db/telegram";
import { handleUpdate } from "./bot";
import { buildWeeklyDrafts, CB_DISCARD, CB_EDIT, CB_IMAGE, CB_LINK, CB_PUBLISH, CB_VERSION, CB_WEEKLY, handleChangelogCallback, receiveDraft, runWeekly, weeklyDue } from "./changelog";
import { ADMIN_TG, botDeps, queued } from "./testing";
import type { XClient, XConfig, XDeps, XResult } from "@/lib/x/client";

/**
 * One update, two drafts: "📢 TELEGRAM · Borrador" and "🐦 X · Borrador", each with its three versions and its own
 * buttons. The post on X goes out only when an ADMIN presses "Publicar en X", once, with the text that message shows —
 * and X is called ONCE, whatever it answers. Small updates wait for Monday's weekly summary. On an in-memory Postgres;
 * X and Telegram are stubs.
 */

process.env.PANDA_ORDERS_ALLOWLIST = "*";
const CHANNEL = "-1001";
const MONDAY_NOON = Date.UTC(2026, 9, 12, 12); // 12 October 2026 is a Monday
const DAY = 86_400_000;

const tg = (n: number, mark = "") => ({
  new: [`${mark}Thing number ${n} is new on every coin page.`],
  es: { summary: `TGES-${n} Cuenta que hay una cosa nueva en la página de cada moneda.` },
});
const DRAFT = (mark = "") => ({
  level: "important",
  digest: `${mark}holdings on every coin page`,
  versions: [tg(1, mark), tg(2, mark), tg(3, mark)],
  x: [
    { text: `${mark}You can now see how much of a coin you hold right on its page.`, es: { summary: "XES-1 Cuenta que ahora ves tu saldo de cada moneda.", tone: "directo" } },
    { text: `${mark}Small one today. Your balance of each coin shows above the trade box.`, es: "XES-2 Lo mismo, más informal." },
    { text: `${mark}Open a coin on PANDA and what you hold is right there.`, es: "XES-3 Versión muy corta." },
  ],
});

type Posted = { text: string; mediaId?: string };
function fakeX(over: { config?: Partial<XConfig>; post?: (text: string) => XResult<{ id: string }>; upload?: XResult<{ mediaId: string }>; image?: { ok: false; reason: string }; paused?: boolean; noClient?: boolean } = {}) {
  const posted: Posted[] = [];
  const uploads: number[] = [];
  const images: string[] = [];
  let n = 1000;
  const client: XClient = {
    verify: async () => ({ ok: true, value: { id: "1", username: "LaunchOnPanda" } }),
    uploadImage: async (bytes) => {
      uploads.push(bytes.length);
      return over.upload ?? { ok: true, value: { mediaId: "media-1" } };
    },
    post: async (text, mediaId) => {
      posted.push({ text, ...(mediaId ? { mediaId } : {}) });
      return over.post ? over.post(text) : { ok: true, value: { id: String(++n) } };
    },
  };
  const deps: XDeps = {
    config: { enabled: true, creds: null, missing: [], maxPerDay: 1, defaultImageUrl: null, ...over.config },
    client: over.noClient ? null : client,
    fetchImage: async (url) => {
      images.push(url);
      return over.image ?? { ok: true, bytes: new Uint8Array(12), mime: "image/png" };
    },
    paused: async () => !!over.paused,
  };
  return { deps, posted, uploads, images };
}

const DRAFT_MESSAGE = 77;
let updateId = 500_000;
const press = (data: string, from = ADMIN_TG) => ({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, data, from: { id: from, language_code: "es" }, message: { message_id: DRAFT_MESSAGE, chat: { id: from, type: "private" } } } });
const answer = (text: string, from = ADMIN_TG) => ({ update_id: ++updateId, message: { message_id: 9000 + updateId, chat: { id: from, type: "private" }, from: { id: from, language_code: "es" }, text, reply_to_message: { message_id: 500 } } });
type Keyboard = { text: string; callback_data: string }[][];
const keyboard = (payload: Record<string, unknown>) => (payload.reply_markup as { inline_keyboard: Keyboard }).inline_keyboard;

/** A fresh database, an X stub, and an important update already received (its two drafts sent). */
async function setup(x = fakeX(), input: unknown = DRAFT(), at = MONDAY_NOON + DAY) {
  const db: Db = await newTestDb();
  const edits: Record<string, unknown>[] = [];
  const toasts: (string | undefined)[] = [];
  const d = botDeps(db, { x: x.deps, editMessage: async (_c, _m, payload) => void edits.push(payload), answerCallback: async (_id, text) => void toasts.push(text) });
  d.clock.t = at;
  const r = await receiveDraft(d, input);
  if (!r.ok) throw new Error(JSON.stringify(r));
  const dms = async () => (await queued(db, ADMIN_TG)).map((m) => m.text);
  return { db, d, r, x, edits, toasts, dms, tgId: r.id, xId: r.xId! };
}
const lastDm = async (s: { dms: () => Promise<string[]> }) => (await s.dms()).at(-1)!;

// ── two drafts, each labelled ───────────────────────────────────────────────────────────────────────────────────────

test("an important update → TWO separate private messages: '📢 TELEGRAM · Borrador' and '🐦 X · Borrador', each with its 3 versions and buttons; nothing published", async () => {
  const s = await setup();
  const messages = await queued(s.db, ADMIN_TG);
  assert.equal(messages.length, 2);
  assert.ok(messages[0].text.startsWith("<b>📢 TELEGRAM · Borrador</b> · Versión 1/3\n\n🛠 PANDA Update"));
  assert.ok(messages[1].text.startsWith("<b>🐦 X · Borrador</b> · Versión 1/3\n\nYou can now see how much of a coin you hold right on its page."));
  // X: the post as it would go out, the summary apart, then the facts (length, image, link, approximate cost).
  const [post, summary, facts] = messages[1].text.split(/\n\n———\n|\n\n(?=<i>\d)/);
  assert.ok(!post.includes("XES-") && !post.includes("PANDA Update") && !post.includes("launchonpanda"));
  assert.equal(summary, "<i>🇪🇸 En resumen: XES-1 Cuenta que ahora ves tu saldo de cada moneda.\nTono: directo</i>");
  assert.equal(facts, "<i>62/280 caracteres · imagen: no · enlace: no · coste aprox.: 0,015 $</i>");
  assert.deepEqual(keyboard(messages[1].payload).map((row) => row.map((b) => b.text)), [["• 1 •", "2", "3", "🔄"], ["✏️ Editar"], ["🖼 Imagen: no", "🔗 Enlace: no"], ["⏳ Al resumen semanal"], ["✅ Publicar en X", "❌ Descartar"]]);
  assert.ok(keyboard(messages[1].payload).flat().every((b) => /^[a-z0-9_]{1,40}$/.test(b.callback_data)), "every button fits what the webhook accepts");
  assert.deepEqual(keyboard(messages[0].payload).map((row) => row.map((b) => b.text)), [["• 1 •", "2", "3", "🔄"], ["✏️ Editar"], ["✅ Publicar", "❌ Descartar"]]);
  assert.equal((await queued(s.db, CHANNEL)).length, 0);
  assert.equal(s.x.posted.length, 0);
});

test("the drafts for X are checked on arrival: over 280, a list, a stock phrase, two alike, or only two → refused with the reason, and nothing is stored or sent", async () => {
  const db = await newTestDb();
  const d = botDeps(db, { x: fakeX().deps });
  const withX = (x: unknown) => ({ ...DRAFT(), x });
  const good = DRAFT().x;
  const cases: [unknown, RegExp][] = [
    [[good[0], good[1], { ...good[2], text: `${"A very long sentence about holdings. ".repeat(9)}` }], /X version 3: .*more than 280 characters/],
    [[good[0], good[1], { ...good[2], text: "New on PANDA:\n- your holdings\n- faster trades" }], /X version 3: .*a list/],
    [[good[0], { ...good[1], text: "Excited to announce your holdings on every coin page." }, good[2]], /X version 2: .*marketing phrase/],
    [[good[0], good[1], { ...good[2], text: "Your holdings on every coin page — finally." }], /X version 3: .*long dash/],
    [[good[0], good[1], { ...good[2], text: "Your holdings on every coin page #PANDA" }], /X version 3: .*hashtag/],
    [[good[0], good[1], { ...good[2], text: "See your holdings at launchonpanda.app" }], /X version 3: .*link or a domain/],
    [[good[0], good[1], { ...good[2], text: "We fixed an exploit in the buy flow." }], /X version 3: .*security detail/],
    [[good[0], good[1], { ...good[1], text: good[1].text.toUpperCase() }], /two versions are the same/],
    [[good[0], good[1]], /exactly 3 versions for X \(got 2\)/],
    [undefined, /exactly 3 versions for X \(got 0\)/],
    [[good[0], good[1], { text: good[2].text }], /X version 3 · the Spanish summary/],
  ];
  for (const [x, why] of cases) {
    const r = await receiveDraft(d, withX(x));
    assert.ok(!r.ok && r.status === 422 && why.test((r.problems ?? []).join(" | ")), `${why} ← ${JSON.stringify(r)}`);
  }
  const noDigest = await receiveDraft(d, { ...DRAFT(), digest: undefined });
  assert.ok(!noDigest.ok && /Digest .*missing/.test(noDigest.problems!.join()));
  const badImage = await receiveDraft(d, { ...DRAFT(), imageUrl: "http://example.org/a.png" });
  assert.ok(!badImage.ok && /Image: it must be an https link/.test(badImage.problems!.join()));
  assert.equal((await tgListChangelogs(db, 50)).length, 0);
  assert.equal((await queued(db, ADMIN_TG)).length, 0);
});

// ── publishing ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("✅ Publicar en X: the version THAT message shows goes out, once — its English text only; the id is kept and the admin gets the link", async () => {
  const s = await setup();
  await handleUpdate(s.d, press(`${CB_VERSION}${s.xId}_1`));
  assert.ok(String(s.edits[0].text).startsWith("<b>🐦 X · Borrador</b> · Versión 2/3\n\nSmall one today."));
  const publish = keyboard(s.edits[0]).at(-1)![0];
  assert.equal(publish.text, "✅ Publicar en X");
  assert.equal(await handleUpdate(s.d, press(publish.callback_data)), "handled");
  assert.deepEqual(s.x.posted, [{ text: "Small one today. Your balance of each coin shows above the trade box." }]);
  const row = (await tgGetChangelog(s.db, s.xId))!;
  assert.deepEqual([row.status, row.publishedVersion, row.decidedBy, row.text], ["published", 1, ADMIN_TG, s.x.posted[0].text]);
  assert.deepEqual((row.meta as { x: { postId: string; url: string } }).x.postId, "1001");
  assert.equal(await lastDm(s), "✅ X: publicado.\nhttps://x.com/i/status/1001");
  assert.ok(String(s.edits.at(-1)!.text).startsWith("<b>✅ X · Publicado · versión 2</b>") && s.edits.at(-1)!.reply_markup === undefined);
  assert.deepEqual(s.d.audits, ["x.post.publish"]);
  // The Spanish summary never left the private chat: not to X, not to the channel.
  assert.ok(!JSON.stringify(s.x.posted).match(/XES-|TGES-|En resumen|Tono|Borrador|🇪🇸/));
  assert.equal((await queued(s.db, CHANNEL)).length, 0, "publishing on X publishes nothing on Telegram");
  // The Telegram draft is its own decision: still pending.
  assert.equal((await tgGetChangelog(s.db, s.tgId))?.status, "pending");
});

test("pressed twice, or pressed again later: published ONCE", async () => {
  const s = await setup();
  const data = `${CB_PUBLISH}${s.xId}_0`;
  const [a, b] = await Promise.all([handleChangelogCallback(s.d, { data, fromId: ADMIN_TG, chatId: ADMIN_TG }), handleChangelogCallback(s.d, { data, fromId: ADMIN_TG, chatId: ADMIN_TG })]);
  assert.deepEqual([a.outcome, b.outcome].sort(), ["already", "published"]);
  for (const again of [data, `${CB_PUBLISH}${s.xId}_2`, `${CB_DISCARD}${s.xId}`, `${CB_WEEKLY}${s.xId}`, `${CB_LINK}${s.xId}_0`, `${CB_EDIT}${s.xId}_0`]) {
    const r = await handleChangelogCallback(s.d, { data: again, fromId: ADMIN_TG, chatId: ADMIN_TG });
    assert.deepEqual([r.outcome, r.toast], ["already", "Ya está publicado."], again);
  }
  assert.equal(s.x.posted.length, 1);
});

test("every button of the X draft pressed by someone who is NOT an admin does nothing", async () => {
  const s = await setup(fakeX({ config: { defaultImageUrl: "https://launchonpanda.app/og.png" } }));
  const stranger = 424242;
  for (const data of [`${CB_PUBLISH}${s.xId}_0`, `${CB_VERSION}${s.xId}_1`, `${CB_EDIT}${s.xId}_0`, `${CB_IMAGE}${s.xId}_0`, `${CB_LINK}${s.xId}_0`, `${CB_WEEKLY}${s.xId}`, `${CB_DISCARD}${s.xId}`]) {
    assert.equal(await handleUpdate(s.d, press(data, stranger)), "ignored", data);
  }
  await handleUpdate(s.d, answer("A sneaky post from a stranger.", stranger));
  const row = (await tgGetChangelog(s.db, s.xId))!;
  assert.deepEqual([row.status, row.versions.length, (row.meta as { x: { image: boolean; link: boolean } }).x.image, (row.meta as { x: { link: boolean } }).x.link], ["pending", 3, false, false]);
  assert.deepEqual([s.x.posted.length, s.edits.length, s.d.audits.length], [0, 0, 0]);
  assert.ok(s.toasts.length === 7 && s.toasts.every((t) => t === "Solo un admin de PANDA puede hacer esto."));
});

test("never the same text twice: a new draft whose version says what was already published is refused before calling X", async () => {
  const s = await setup();
  await handleUpdate(s.d, press(`${CB_PUBLISH}${s.xId}_0`));
  s.d.clock.t += DAY; // another day: the daily limit isn't what stops it
  const again = await receiveDraft(s.d, { ...DRAFT(), x: [{ ...DRAFT().x[0], text: "you can now see how much of a coin you hold, right on its page" }, DRAFT().x[1], DRAFT().x[2]] });
  if (!again.ok) throw new Error(JSON.stringify(again));
  const r = await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${again.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.equal(r.outcome, "duplicate");
  assert.match(await lastDm(s), /Ese mismo texto ya se publicó en X/);
  assert.equal(s.x.posted.length, 1);
  assert.equal((await tgGetChangelog(s.db, again.xId!))?.status, "pending", "another version can still be chosen");
  assert.equal((await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${again.xId}_1`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "published");
});

test("X says no: the admin is told why, NOTHING is retried, and the draft stays as it was — pressing again is a person's decision", async () => {
  let answerNo = true;
  const x = fakeX({ post: () => (answerNo ? { ok: false, kind: "rejected", status: 403, reason: "You are not permitted to perform this action (not allowed)" } : { ok: true, value: { id: "555" } }) });
  const s = await setup(x);
  const r = await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${s.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.equal(r.outcome, "failed");
  assert.equal(x.posted.length, 1, "one call to X, no loop");
  const told = await lastDm(s);
  assert.ok(told.startsWith("⚠️ X · No se ha publicado nada. X ha rechazado el post: You are not permitted to perform this action (not allowed).") && told.includes("No lo reintento solo"), told);
  assert.equal((await tgGetChangelog(s.db, s.xId))?.status, "pending");
  assert.deepEqual(s.d.audits, ["x.post.rejected"]);
  // Time passing changes nothing by itself (the cron's weekly step included): still one call.
  s.d.clock.t += 3 * DAY;
  await runWeekly(s.d);
  assert.equal(x.posted.length, 1);
  // The admin presses again once it is solved: that one goes through.
  answerNo = false;
  assert.equal((await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${s.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "published");
  assert.equal(x.posted.length, 2);
});

test("X doesn't answer (or answers nonsense): the post MAY exist, so the draft is closed for good and can never be sent again", async () => {
  const x = fakeX({ post: () => ({ ok: false, kind: "unknown", status: null, reason: "X didn't answer in time" }) });
  const s = await setup(x);
  assert.equal((await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${s.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "failed");
  assert.match(await lastDm(s), /No sé si se ha publicado: X didn't answer in time\.[\s\S]*Mira el perfil de X antes de hacer nada/);
  assert.equal((await tgGetChangelog(s.db, s.xId))?.status, "failed");
  for (const data of [`${CB_PUBLISH}${s.xId}_0`, `${CB_PUBLISH}${s.xId}_1`]) {
    const r = await handleChangelogCallback(s.d, { data, fromId: ADMIN_TG, chatId: ADMIN_TG });
    assert.deepEqual([r.outcome, r.toast], ["already", "Quedó cerrado: revisa X."]);
  }
  assert.equal(x.posted.length, 1);
  assert.deepEqual(s.d.audits, ["x.post.unknown"]);
});

test("switched off, paused from /admin, or a credential missing: nothing is sent to X and the draft stays", async () => {
  for (const [x, why] of [
    [fakeX({ config: { enabled: false } }), /está apagado/],
    [fakeX({ paused: true }), /pausa de emergencia/],
    [fakeX({ noClient: true, config: { missing: ["X_ACCESS_TOKEN"] } }), /Faltan credenciales de X en el servidor: X_ACCESS_TOKEN\./],
  ] as const) {
    const s = await setup(x);
    assert.equal((await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${s.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "off");
    assert.match(await lastDm(s), why);
    assert.match(await lastDm(s), /No se ha publicado nada\.$/);
    assert.equal(x.posted.length, 0);
    assert.equal((await tgGetChangelog(s.db, s.xId))?.status, "pending");
  }
  // No X at all wired in (a deployment that never set it up).
  const s = await setup();
  const r = await handleChangelogCallback({ ...s.d, x: undefined }, { data: `${CB_PUBLISH}${s.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.equal(r.outcome, "off");
});

test("at most X_MAX_POSTS_PER_DAY a day: the next one is NOT published — the admin is told and it is kept for the weekly summary", async () => {
  const x = fakeX();
  const s = await setup(x);
  await handleUpdate(s.d, press(`${CB_PUBLISH}${s.xId}_0`));
  const second = await receiveDraft(s.d, DRAFT("Again: "));
  if (!second.ok) throw new Error(JSON.stringify(second));
  const r = await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${second.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG, messageId: DRAFT_MESSAGE });
  assert.equal(r.outcome, "limit");
  assert.equal(x.posted.length, 1, "X is not called");
  assert.match(await lastDm(s), /Hoy ya se ha publicado en X el máximo \(1 al día\)\. No se ha publicado nada y este borrador queda guardado para el resumen semanal del lunes\./);
  assert.equal((await tgGetChangelog(s.db, second.xId!))?.status, "deferred");
  assert.ok(String(s.edits.at(-1)!.text).startsWith("<b>⏳ X · Guardado para el resumen semanal</b>"));
  // The next day there is room again; and with a higher limit two fit in one day.
  s.d.clock.t += DAY;
  const third = await receiveDraft(s.d, DRAFT("Third: "));
  if (!third.ok) throw new Error(JSON.stringify(third));
  assert.equal((await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${third.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "published");
  const two = await setup(fakeX({ config: { maxPerDay: 2 } }));
  await handleUpdate(two.d, press(`${CB_PUBLISH}${two.xId}_0`));
  const more = await receiveDraft(two.d, DRAFT("More: "));
  if (!more.ok) throw new Error(JSON.stringify(more));
  assert.equal((await handleChangelogCallback(two.d, { data: `${CB_PUBLISH}${more.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "published");
});

// ── image, link, edit ───────────────────────────────────────────────────────────────────────────────────────────────

test("🖼 Imagen and 🔗 Enlace: off by default, each press rewrites the preview (and the cost); what is on is what gets published", async () => {
  const x = fakeX({ config: { defaultImageUrl: "https://launchonpanda.app/og.png" } });
  const s = await setup(x);
  assert.equal(await handleUpdate(s.d, press(`${CB_IMAGE}${s.xId}_2`)), "handled");
  assert.ok(String(s.edits[0].text).startsWith("<b>🐦 X · Borrador</b> · Versión 3/3") && String(s.edits[0].text).endsWith("<i>54/280 caracteres · imagen: sí · enlace: no · coste aprox.: 0,015 $ + subir la imagen</i>"), String(s.edits[0].text));
  assert.deepEqual(keyboard(s.edits[0])[2].map((b) => b.text), ["🖼 Imagen: sí", "🔗 Enlace: no"]);
  await handleUpdate(s.d, press(`${CB_LINK}${s.xId}_2`));
  const preview = String(s.edits[1].text);
  assert.ok(preview.includes("Open a coin on PANDA and what you hold is right there.\nhttps://launchonpanda.app\n\n———"), preview);
  assert.ok(preview.endsWith("<i>78/280 caracteres · imagen: sí · enlace: sí · coste aprox.: 0,20 $ + subir la imagen</i>"), preview);
  assert.deepEqual(s.toasts, ["Imagen: sí", "Enlace: sí"]);
  await handleUpdate(s.d, press(keyboard(s.edits[1]).at(-1)![0].callback_data));
  assert.deepEqual(x.images, ["https://launchonpanda.app/og.png"]);
  assert.deepEqual(x.uploads, [12]);
  assert.deepEqual(x.posted, [{ text: "Open a coin on PANDA and what you hold is right there.\nhttps://launchonpanda.app", mediaId: "media-1" }]);
  // Pressing again switches it back off.
  const t = await setup(fakeX({ config: { defaultImageUrl: "https://launchonpanda.app/og.png" } }));
  await handleUpdate(t.d, press(`${CB_LINK}${t.xId}_0`));
  await handleUpdate(t.d, press(`${CB_LINK}${t.xId}_0`));
  assert.deepEqual(t.toasts, ["Enlace: sí", "Enlace: no"]);
});

test("the announcement's own image is on from the start; with no image anywhere the button says so; a link that wouldn't fit is refused", async () => {
  const own = await setup(fakeX(), { ...DRAFT(), imageUrl: "https://launchonpanda.app/coin.png" });
  assert.ok((await own.dms())[1].includes("imagen: sí"));
  await handleUpdate(own.d, press(`${CB_PUBLISH}${own.xId}_0`));
  assert.deepEqual(own.x.images, ["https://launchonpanda.app/coin.png"]);
  const none = await setup();
  const r = await handleChangelogCallback(none.d, { data: `${CB_IMAGE}${none.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.deepEqual([r.outcome, r.toast], ["unknown", "No hay ninguna imagen: ni la del anuncio ni la imagen por defecto."]);
  const long = "Holdings ".repeat(29).trim() + "."; // 261 characters: fine alone, too long with the link's 24
  const tight = await setup(fakeX(), { ...DRAFT(), x: [{ ...DRAFT().x[0], text: long }, DRAFT().x[1], DRAFT().x[2]] });
  const l = await handleChangelogCallback(tight.d, { data: `${CB_LINK}${tight.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.deepEqual([l.outcome, l.toast], ["unknown", "Con el enlace esta versión no cabe en 280 caracteres."]);
});

test("the image can't be prepared or X refuses it: nothing is posted, the admin is told, the draft stays", async () => {
  for (const [x, why] of [
    [fakeX({ image: { ok: false, reason: "the image couldn't be downloaded (HTTP 404)" } }), /No he podido preparar la imagen: the image couldn't be downloaded \(HTTP 404\)/],
    [fakeX({ upload: { ok: false, kind: "rejected", status: 400, reason: "media type unrecognized (HTTP 400)" } }), /X no ha aceptado la imagen: media type unrecognized/],
  ] as const) {
    const s = await setup(x, { ...DRAFT(), imageUrl: "https://launchonpanda.app/coin.png" });
    assert.equal((await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${s.xId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "failed");
    assert.match(await lastDm(s), why);
    assert.equal(x.posted.length, 0);
    assert.equal((await tgGetChangelog(s.db, s.xId))?.status, "pending");
  }
});

test("✏️ Editar on the X draft: my text follows the same rules (no list, no stock phrases, 280); a good one becomes '4 · mía' and is what gets published", async () => {
  const s = await setup();
  await handleUpdate(s.d, press(`${CB_EDIT}${s.xId}_0`));
  assert.match(await lastDm(s), /^✏️ Responde a este mensaje con tu texto para X: un post corto en inglés \(máximo 280 caracteres\)/);
  await handleUpdate(s.d, answer("New:\n- holdings on each page\n- faster trades"));
  assert.match(await lastDm(s), /No se puede usar ese texto en X: contiene a list/);
  await handleUpdate(s.d, answer("We're thrilled to show your holdings."));
  assert.match(await lastDm(s), /marketing phrase/);
  assert.equal((await tgGetChangelog(s.db, s.xId))?.versions.length, 3);
  await handleUpdate(s.d, answer("Your holdings now show on every coin page. That's it, that's the update."));
  const row = (await tgGetChangelog(s.db, s.xId))!;
  assert.deepEqual([row.versions.length, row.versions[3].mine, row.versions[3].es], [4, true, null]);
  const shown = s.edits.at(-1)!;
  assert.ok(String(shown.text).startsWith("<b>🐦 X · Borrador</b> · Versión 4 · mía\n\nYour holdings now show on every coin page.") && !String(shown.text).includes("En resumen"));
  await handleUpdate(s.d, press(keyboard(shown).at(-1)![0].callback_data));
  assert.deepEqual(s.x.posted, [{ text: "Your holdings now show on every coin page. That's it, that's the update." }]);
});

// ── small updates and the weekly summary ────────────────────────────────────────────────────────────────────────────

const SMALL = (n: number) => ({ level: "small", digest: `small thing ${n} works better`, versions: [tg(n * 10 + 1), tg(n * 10 + 2), tg(n * 10 + 3)] });

test("a SMALL update gets no draft: it is kept for Monday, and the admin only gets a note", async () => {
  const s = await setup(fakeX(), SMALL(1));
  assert.deepEqual([s.r.ok && s.r.deferred, s.xId], [true, null]);
  assert.deepEqual(await s.dms(), ["🗂 Actualización pequeña guardada para el resumen semanal del lunes (1 en espera). No se publica nada ahora.\n\n«small thing 1 works better»"]);
  assert.equal((await tgGetChangelog(s.db, s.tgId))?.status, "deferred");
  const r = await handleChangelogCallback(s.d, { data: `${CB_PUBLISH}${s.tgId}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG });
  assert.deepEqual([r.outcome, r.toast], ["already", "Ya está guardado para el resumen semanal."], "it can't be published on its own");
  assert.equal((await queued(s.db, CHANNEL)).length, 0);
});

test("Monday: the week's small updates become ONE draft for Telegram and ONE for X; once; what went in is never summarised again", async () => {
  assert.equal(weeklyDue(Date.UTC(2026, 9, 12, 7, 59)), null, "Monday, too early");
  assert.equal(weeklyDue(Date.UTC(2026, 9, 12, 8)), "2026-10-12");
  assert.equal(weeklyDue(Date.UTC(2026, 9, 13, 12)), null, "Tuesday");
  assert.equal(weeklyDue(Date.UTC(2026, 9, 11, 23)), null, "Sunday");

  const s = await setup(fakeX(), SMALL(1), MONDAY_NOON - 3 * DAY); // Friday
  await receiveDraft(s.d, SMALL(2));
  assert.equal(await runWeekly(s.d), "not due");
  s.d.clock.t = MONDAY_NOON;
  assert.equal(await runWeekly(s.d), "summary of 2");
  const drafts = (await queued(s.db, ADMIN_TG)).filter((m) => m.text.includes("Borrador"));
  assert.equal(drafts.length, 2);
  assert.ok(drafts[0].text.startsWith("<b>📢 TELEGRAM · Borrador</b> · Versión 1/3 · resumen semanal\n\n🛠 PANDA Update · October 12, 2026\n\n✨ New\n- Thing number 11 is new on every coin page.\n- Thing number 21 is new on every coin page.\n\n🌐 launchonpanda.app"), drafts[0].text);
  assert.ok(drafts[0].text.includes("🇪🇸 En resumen: Es el resumen de la semana: junta en un solo mensaje las 2 novedades pequeñas que estaban guardadas."));
  assert.ok(drafts[1].text.startsWith("<b>🐦 X · Borrador</b> · Versión 1/3 · resumen semanal\n\nThis week on PANDA: small thing 1 works better and small thing 2 works better."), drafts[1].text);
  assert.ok(!keyboard(drafts[1].payload).flat().some((b) => b.text.includes("resumen semanal")), "a weekly summary can't be sent to the weekly summary");
  assert.equal((await tgDeferredDrafts(s.db)).length, 0);
  // The same Monday again, and the following days: nothing more.
  assert.equal(await runWeekly(s.d), "done already");
  s.d.clock.t += DAY;
  assert.equal(await runWeekly(s.d), "not due");
  assert.equal((await queued(s.db, ADMIN_TG)).filter((m) => m.text.includes("Borrador")).length, 2);
  // The weekly drafts are ordinary drafts: nothing is published until the admin presses, and then it is.
  const weekly = (await tgListChangelogs(s.db, 20)).filter((r) => r.status === "pending");
  assert.deepEqual(weekly.map((r) => r.kind).sort(), ["changelog", "x"]);
  assert.equal(s.x.posted.length, 0);
  await handleUpdate(s.d, press(`${CB_PUBLISH}${weekly.find((r) => r.kind === "x")!.id}_0`));
  assert.deepEqual(s.x.posted, [{ text: "This week on PANDA: small thing 1 works better and small thing 2 works better." }]);
});

test("an empty week: nothing is built and nobody is written to", async () => {
  const db = await newTestDb();
  const d = botDeps(db, { x: fakeX().deps });
  d.clock.t = MONDAY_NOON;
  assert.deepEqual(await buildWeeklyDrafts(d), { telegram: null, x: null, items: 0 });
  assert.equal(await runWeekly(d), "nothing waiting");
  assert.equal((await queued(db, ADMIN_TG)).length, 0);
  assert.equal((await tgListChangelogs(db, 10)).length, 0);
  assert.equal(await runWeekly(d), "done already");
});

test("⏳ Al resumen semanal: an important update's post for X can wait for Monday instead — then only X gets a weekly draft", async () => {
  const s = await setup(fakeX(), DRAFT(), MONDAY_NOON - 2 * DAY);
  assert.equal(await handleUpdate(s.d, press(`${CB_WEEKLY}${s.xId}`)), "handled");
  assert.equal((await tgGetChangelog(s.db, s.xId))?.status, "deferred");
  assert.equal(await lastDm(s), "⏳ X: guardado para el resumen semanal del lunes. No se ha publicado nada.");
  assert.equal((await tgGetChangelog(s.db, s.tgId))?.status, "pending", "its Telegram draft is not touched");
  s.d.clock.t = MONDAY_NOON;
  const built = await buildWeeklyDrafts(s.d);
  assert.deepEqual([built.telegram, typeof built.x, built.items], [null, "string", 1]);
  assert.ok((await lastDm(s)).startsWith("<b>🐦 X · Borrador</b> · Versión 1/3 · resumen semanal\n\nThis week on PANDA: holdings on every coin page."));
  assert.equal(s.x.posted.length, 0);
});
