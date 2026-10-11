import { test } from "node:test";
import assert from "node:assert/strict";
import { newTestDb } from "@/lib/db/testing";
import { pgAddUpdates, pgGetUpdate, pgListUpdates, pgSetUpdateImages } from "@/lib/db/updates";
import { tgGetChangelog } from "@/lib/db/telegram";
import { handleUpdate } from "@/lib/telegram/bot";
import { buildWeeklyDrafts, CB_DISCARD, CB_EDIT, CB_PUBLISH, CB_VERSION, handleChangelogCallback, parseDraftMarkdown, receiveDraft, receiveHistory, receiveImages, shotMessages, webMessages } from "@/lib/telegram/changelog";
import { ADMIN_TG, botDeps, queued } from "@/lib/telegram/testing";
import { readFileSync } from "node:fs";
import { checkEntry, checkHistory, checkImageAssignments, checkWebEntries, imageOf, imageVariants, isScreenshotPath, localizedImage, sentences, slugFor, SLUG_RE, type UpdateEntry } from "./format";

/**
 * The public Updates page: what an entry may say, where entries come from (a changelog published from the bot, and the
 * project's history once an admin approves it), and that nothing reaches the page any other way. In-memory Postgres.
 */

process.env.PANDA_ORDERS_ALLOWLIST = "*";
const NOW = Date.UTC(2026, 9, 13, 12); // a Tuesday
const CHANNEL = "-1001";

const entry = (over: Record<string, unknown> = {}) => ({
  tag: "new",
  title: { en: "Sell and stop orders on the chart", es: "Ventas y stops en el gráfico" },
  body: {
    en: "You can now draw a sell or a stop on the chart for a coin you already hold. Pick the price and how much to sell, then approve it in your wallet. It runs on its own, even with the site closed.",
    es: "Ya puedes dibujar una venta o un stop en el gráfico de una moneda que tienes. Elige el precio y cuánto vender, y apruébalo en tu wallet. Se ejecuta solo, aunque cierres la web.",
  },
  ...over,
});
const tg = (n: number) => ({ new: [`Thing number ${n} is new.`], es: `Cuenta la novedad número ${n}.` });
const draft = (over: Record<string, unknown> = {}) => ({
  level: "important",
  digest: "orders on the chart for everyone",
  versions: [tg(1), tg(2), tg(3)],
  x: [1, 2, 3].map((n) => ({ text: `Orders on the chart are here, wording number ${n} of this post.`, es: "Cuenta que hay órdenes en el gráfico." })),
  web: [entry()],
  ...over,
});
let updateId = 700_000;
const press = (data: string, from = ADMIN_TG) => ({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, data, from: { id: from, language_code: "es" }, message: { message_id: 77, chat: { id: from, type: "private" } } } });
async function setup() {
  const db = await newTestDb();
  const d = botDeps(db);
  d.clock.t = NOW;
  return { db, d };
}

// ── what an entry may say ───────────────────────────────────────────────────────────────────────────────────────────

test("an entry: a tag, a short title and two to five sentences, in English AND Spanish; an image only from the site or https", () => {
  const ok = checkEntry(entry({ imageUrl: "/updates/orders.png" }));
  assert.ok(ok.ok && ok.entry.tag === "new" && ok.entry.imageUrl === "/updates/orders.png");
  assert.equal(checkEntry(entry({ tag: "Fixed" })).ok, true, "the tag is read whatever its case");
  const problems = (over: Record<string, unknown>) => {
    const r = checkEntry(entry(over));
    return r.ok ? "" : r.problems.join(" | ");
  };
  assert.match(problems({ tag: "news" }), /New, Improved or Fixed/);
  assert.match(problems({ title: { en: "Only English" } }), /the ES title is missing/);
  assert.match(problems({ title: { en: "x".repeat(71), es: "Bien" } }), /the EN title is longer than 70/);
  assert.match(problems({ body: { en: "Only one sentence here.", es: entry().body.es } }), /the EN text must be 2 to 5 sentences \(it has 1\)/);
  assert.match(problems({ body: { en: entry().body.en, es: "Una. Dos. Tres. Cuatro. Cinco. Seis." } }), /the ES text must be 2 to 5 sentences \(it has 6\)/);
  assert.match(problems({ body: { en: `${"A long sentence about orders. ".repeat(25)}`, es: entry().body.es } }), /longer than 600/);
  assert.match(problems({ body: { en: "Orders are <b>here</b>. Use them.", es: entry().body.es } }), /markup/);
  assert.match(problems({ imageUrl: "http://example.org/a.png" }), /image must be/);
  assert.match(problems({ imageUrl: "/../secret.png" }), /image must be/);
  assert.equal(imageOf("https://launchonpanda.app/a.png"), "https://launchonpanda.app/a.png");
  assert.equal(imageOf(undefined), null);
  assert.equal(sentences("One. Two! Three? Pump.fun coins count as one more."), 4);
});

test("the same content rules as the changelog: no security detail, internal wallets, admin, settings, infrastructure, private features or promises — in either language", () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ body: { en: "We closed an exploit in the buy flow. It is safe now.", es: entry().body.es } }, /EN text can't be published.*security detail/],
    [{ body: { en: "Fees now go to 35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh. Check it.", es: entry().body.es } }, /wallet address/],
    [{ body: { en: "There is a new panel in /admin. Use it.", es: entry().body.es } }, /admin area/],
    [{ body: { en: "Set FEATURE_X_POSTING to try it. It works.", es: entry().body.es } }, /variable or secret/],
    [{ body: { en: "We moved the database to a new region. It is faster.", es: entry().body.es } }, /infrastructure/],
    [{ body: { en: "Staking is coming soon. Get ready.", es: entry().body.es } }, /promise about the future/],
    [{ title: { en: "This coin will pump", es: "Bien" } }, /EN title can't be published.*price or rewards/],
    [{ body: { en: entry().body.en, es: "Se cerró un fallo en la wallet 35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh. Ya está." } }, /ES text can't be published.*wallet address/],
  ];
  for (const [over, why] of bad) {
    const r = checkEntry(entry(over));
    assert.ok(!r.ok && why.test(r.problems.join(" | ")), `${why} ← ${JSON.stringify(r)}`);
  }
  // PANDA orders may be named only while they are open to everyone.
  delete process.env.PANDA_ORDERS_ALLOWLIST;
  try {
    assert.match((checkEntry(entry({ title: { en: "PANDA orders for everyone", es: "Órdenes para todos" } })) as { problems: string[] }).problems.join(), /isn't open to everyone/);
  } finally {
    process.env.PANDA_ORDERS_ALLOWLIST = "*";
  }
});

test("a draft brings one to four entries; the history brings dated ones, sorted oldest first, never in the future", () => {
  assert.match((checkWebEntries(undefined) as { problems: string[] }).problems[0], /detailed version for the Updates page is missing/);
  assert.match((checkWebEntries([]) as { problems: string[] }).problems[0], /missing/);
  assert.match((checkWebEntries(Array(5).fill(entry())) as { problems: string[] }).problems[0], /at most 4 entries/);
  assert.match((checkWebEntries([entry(), entry({ tag: "x" })]) as { problems: string[] }).problems[0], /^Web entry 2: /);
  const h = checkHistory([entry({ date: "2026-10-09" }), entry({ date: "2026-09-18" }), entry({ date: "2026-10-01" })], NOW);
  assert.ok(h.ok && h.entries.map((e) => e.date).join() === "2026-09-18,2026-10-01,2026-10-09");
  for (const date of ["2026-13-40", "yesterday", "2027-01-01", undefined]) {
    const r = checkHistory([entry({ date })], NOW);
    assert.ok(!r.ok && /date must be a past day/.test(r.problems.join()), String(date));
  }
  assert.equal(checkHistory([], NOW).ok, false);
  assert.equal(checkHistory(Array(61).fill(entry({ date: "2026-10-01" })), NOW).ok, false);
});

test("every entry has its own address, from its day and its title", () => {
  assert.equal(slugFor("Sell and stop orders on the chart", NOW), "2026-10-13-sell-and-stop-orders-on-the-chart");
  assert.equal(slugFor("$PANDA is live: buy it here!", NOW), "2026-10-13-panda-is-live-buy-it-here");
  assert.equal(slugFor("¡¡¡", NOW), "2026-10-13-update");
  assert.ok(slugFor("x".repeat(200), NOW).length <= 71);
  for (const t of ["Sell and stop orders on the chart", "Más rápido", "A/B: test — done"]) assert.match(slugFor(t, NOW), SLUG_RE);
});

test("a Markdown draft's '# Web N' blocks: tag, title, the English text, then '### ES' with 'Título:' and the Spanish text", () => {
  const md = ["# Web 1", "Tag: improved", "Title: Faster charts", "Image: /updates/charts.png", "Charts load faster now.", "Open any coin to see it.", "### ES", "Título: Gráficos más rápidos", "Los gráficos cargan más rápido.", "Abre cualquier moneda para verlo.", "# Web 2", "Etiqueta: fixed", "Title: A fix", "One. Two.", "### ES", "Título: Un arreglo", "Uno. Dos."].join("\n");
  assert.deepEqual(parseDraftMarkdown(md).web, [
    { tag: "improved", title: { en: "Faster charts", es: "Gráficos más rápidos" }, body: { en: "Charts load faster now. Open any coin to see it.", es: "Los gráficos cargan más rápido. Abre cualquier moneda para verlo." }, imageUrl: "/updates/charts.png" },
    { tag: "fixed", title: { en: "A fix", es: "Un arreglo" }, body: { en: "One. Two.", es: "Uno. Dos." } },
  ]);
  assert.equal(checkWebEntries(parseDraftMarkdown(md).web).ok, true);
});

// ── the page's data ─────────────────────────────────────────────────────────────────────────────────────────────────

test("entries are listed newest first or oldest first; one can be read by its address; the same title on the same day gets its own address", async () => {
  const { db } = await setup();
  const base = checkEntry(entry());
  if (!base.ok) throw new Error("fixture");
  const day = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const ids = await pgAddUpdates(db, [{ ...base.entry, ts: day("2026-09-18") }, { ...base.entry, title: { en: "Second thing", es: "Segunda cosa" }, ts: day("2026-10-01") }, { ...base.entry, title: { en: "Third thing", es: "Tercera cosa" }, ts: day("2026-10-01") }], "history:a", NOW);
  assert.deepEqual(ids, ["2026-09-18-sell-and-stop-orders-on-the-chart", "2026-10-01-second-thing", "2026-10-01-third-thing"]);
  assert.deepEqual((await pgListUpdates(db, "newest")).map((e) => e.id), ["2026-10-01-third-thing", "2026-10-01-second-thing", "2026-09-18-sell-and-stop-orders-on-the-chart"]);
  assert.deepEqual((await pgListUpdates(db, "oldest")).map((e) => e.id), ["2026-09-18-sell-and-stop-orders-on-the-chart", "2026-10-01-second-thing", "2026-10-01-third-thing"]);
  const one = await pgGetUpdate(db, "2026-10-01-second-thing");
  assert.deepEqual([one?.title.es, one?.tag, one?.imageUrl], ["Segunda cosa", "new", null]);
  assert.equal(await pgGetUpdate(db, "2026-10-01-nope"), null);
  // The same source adding the same thing again changes nothing; another source with the same title gets "-2".
  assert.deepEqual(await pgAddUpdates(db, [{ ...base.entry, ts: day("2026-09-18") }], "history:a", NOW), []);
  assert.deepEqual(await pgAddUpdates(db, [{ ...base.entry, ts: day("2026-09-18") }], "changelog:b", NOW), ["2026-09-18-sell-and-stop-orders-on-the-chart-2"]);
  assert.equal((await pgListUpdates(db)).length, 4);
});

// ── from the bot to the page ────────────────────────────────────────────────────────────────────────────────────────

test("a draft without its detailed version for the web is refused; with it, the admin sees it marked '🌐 WEB', in Spanish and English, with no buttons", async () => {
  const { db, d } = await setup();
  const none = await receiveDraft(d, draft({ web: undefined }));
  assert.ok(!none.ok && none.status === 422 && /Web: the detailed version/.test(none.problems!.join()));
  const bad = await receiveDraft(d, draft({ web: [entry({ body: { en: "We fixed an exploit. All good.", es: entry().body.es } })] }));
  assert.ok(!bad.ok && /Web entry 1: .*security detail/.test(bad.problems!.join()));
  assert.equal((await queued(db, ADMIN_TG)).length, 0);
  const r = await receiveDraft(d, draft());
  assert.ok(r.ok);
  const dms = await queued(db, ADMIN_TG);
  assert.deepEqual(dms.map((m) => m.text.split("</b>")[0]), ["<b>📢 TELEGRAM · Borrador", "<b>🌐 WEB · Para la página Novedades", "<b>🐦 X · Borrador"]);
  const web = dms[1];
  assert.ok(web.text.includes("launchonpanda.app/updates cuando pulses «✅ Publicar» en el borrador de Telegram"));
  assert.ok(web.text.includes("<b>🇪🇸 [Nuevo] Ventas y stops en el gráfico</b>\nYa puedes dibujar una venta") && web.text.includes("<b>🇬🇧 [New] Sell and stop orders on the chart</b>\nYou can now draw a sell"));
  assert.equal(web.payload.reply_markup, undefined);
  assert.equal((await pgListUpdates(db)).length, 0, "nothing is on the page until it is published");
  // Long entries are split into several messages, never cut mid-entry.
  const long = checkWebEntries(Array.from({ length: 4 }, (_, k) => entry({ title: { en: `Entry ${k}`, es: `Entrada ${k}` }, body: { en: `${"A sentence about holdings and trades. ".repeat(14)}Done.`, es: `${"Una frase sobre saldos y operaciones. ".repeat(14)}Fin.` } })));
  assert.equal(long.ok, false, "more than five sentences is refused");
  const many = Array.from({ length: 4 }, (_, k) => ({ tag: "new" as const, imageUrl: null, title: { en: `Entry ${k} ${"x".repeat(50)}`, es: `Entrada ${k} ${"x".repeat(50)}` }, body: { en: "x".repeat(590), es: "y".repeat(590) } }));
  const parts = webMessages(many, "https://launchonpanda.app");
  assert.ok(parts.length > 1 && parts.every((m) => String(m.text).length <= 4096));
  assert.equal(parts.map((m) => String(m.text)).join("\n").match(/🇪🇸 \[/g)!.length, 4);
});

test("✅ Publicar on the Telegram draft also adds its detailed version to the Updates page — once; ❌ Descartar adds nothing", async () => {
  const { db, d } = await setup();
  const r = await receiveDraft(d, draft({ web: [entry(), entry({ tag: "fixed", title: { en: "A fix for the buy button", es: "Un arreglo en el botón de comprar" } })] }));
  if (!r.ok) throw new Error(JSON.stringify(r));
  assert.equal(await handleUpdate(d, press(`${CB_PUBLISH}${r.id}_1`)), "handled");
  const page = await pgListUpdates(db, "oldest");
  assert.deepEqual(page.map((e) => [e.id, e.tag, e.ts]), [["2026-10-13-sell-and-stop-orders-on-the-chart", "new", NOW], ["2026-10-13-a-fix-for-the-buy-button", "fixed", NOW + 1]]);
  assert.equal(page[0].body.es, entry().body.es);
  const told = (await queued(db, ADMIN_TG)).at(-1)!.text;
  assert.equal(told, "✅ TELEGRAM: publicada la versión 2 en el canal.\n🌐 WEB: añadido a la página Novedades (2 entradas).\nhttps://launchonpanda.app/updates/2026-10-13-sell-and-stop-orders-on-the-chart");
  // The channel got the changelog only: nothing of the web text, nothing Spanish.
  const channel = JSON.stringify((await queued(db, CHANNEL)).map((m) => m.payload));
  assert.ok(channel.includes("Thing number 2 is new.") && !channel.includes("Ya puedes dibujar") && !channel.includes("You can now draw a sell") && !channel.includes("WEB"));
  // Pressing again publishes nothing and adds nothing.
  assert.equal((await handleChangelogCallback(d, { data: `${CB_PUBLISH}${r.id}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "already");
  assert.equal((await pgListUpdates(db)).length, 2);
  // Publishing on X adds nothing to the page; discarding a draft adds nothing either.
  const other = await receiveDraft(d, draft({ digest: "another thing for everyone", web: [entry({ title: { en: "Another thing", es: "Otra cosa" } })] }));
  if (!other.ok) throw new Error(JSON.stringify(other));
  await handleUpdate(d, press(`${CB_DISCARD}${other.id}`));
  assert.equal((await pgListUpdates(db)).length, 2);
  // A stranger pressing publish adds nothing.
  const third = await receiveDraft(d, draft({ digest: "a third thing for everyone", web: [entry({ title: { en: "Third thing", es: "Tercera cosa" } })] }));
  if (!third.ok) throw new Error(JSON.stringify(third));
  assert.equal(await handleUpdate(d, press(`${CB_PUBLISH}${third.id}_0`, 424242)), "ignored");
  assert.equal((await pgListUpdates(db)).length, 2);
});

test("the weekly summary carries every small update's detailed version: publishing it adds them all", async () => {
  const { db, d } = await setup();
  for (const n of [1, 2]) {
    const r = await receiveDraft(d, draft({ level: "small", x: undefined, digest: `small thing ${n} works better`, web: [entry({ tag: "improved", title: { en: `Small thing ${n}`, es: `Cosa pequeña ${n}` } })] }));
    assert.ok(r.ok && r.deferred);
  }
  assert.ok(!(await queued(db, ADMIN_TG)).some((m) => m.text.includes("WEB")), "a small update shows nothing for the web until Monday");
  const built = await buildWeeklyDrafts(d);
  assert.ok(built.telegram);
  assert.ok((await queued(db, ADMIN_TG)).some((m) => m.text.startsWith("<b>🌐 WEB · Para la página Novedades</b>") && m.text.includes("Cosa pequeña 1") && m.text.includes("Cosa pequeña 2")));
  await handleUpdate(d, press(`${CB_PUBLISH}${built.telegram}_0`));
  assert.deepEqual((await pgListUpdates(db, "oldest")).map((e) => e.title.en), ["Small thing 1", "Small thing 2"]);
});

// ── the history ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("the history is sent to the admin as a SUMMARY to approve — nothing is on the page until '✅ Publicar historial', pressed by an admin, once", async () => {
  const { db, d } = await setup();
  const history = [entry({ date: "2026-10-09", tag: "improved", title: { en: "Simpler Draw Your Trade", es: "Draw Your Trade más sencillo" } }), entry({ date: "2026-09-18", title: { en: "PANDA goes live", es: "PANDA se estrena" } })];
  const bad = await receiveHistory(d, { history: [entry({ date: "2026-10-09", body: { en: "An exploit was closed. Fine now.", es: entry().body.es } })] });
  assert.ok(!bad.ok && bad.status === 422 && /History entry 1: .*security detail/.test(bad.problems!.join()));
  const r = await receiveHistory(d, { history });
  if (!r.ok) throw new Error(JSON.stringify(r));
  assert.deepEqual([r.entries, r.sentTo], [2, 1]);
  const dm = (await queued(db, ADMIN_TG)).at(-1)!;
  assert.equal(dm.text, "<b>🌐 WEB · Historial · Borrador</b>\n\n2 entradas para la página Novedades (/updates), de la más antigua a la más nueva. Al publicarlas aparecen todas, cada una con su texto en español e inglés.\n\n2026-09-18 · Nuevo · PANDA se estrena\n2026-10-09 · Mejorado · Draw Your Trade más sencillo");
  const buttons = (dm.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
  assert.deepEqual(buttons.map((row) => row.map((b) => b.text)), [["✅ Publicar historial", "❌ Descartar"]]);
  assert.equal((await pgListUpdates(db)).length, 0);
  // A stranger, and the buttons that don't apply to a history, do nothing.
  assert.equal(await handleUpdate(d, press(buttons[0][0].callback_data, 424242)), "ignored");
  for (const data of [`${CB_VERSION}${r.id}_1`, `${CB_EDIT}${r.id}_0`]) assert.equal((await handleChangelogCallback(d, { data, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "unknown");
  assert.equal((await pgListUpdates(db)).length, 0);
  assert.equal(await handleUpdate(d, press(buttons[0][0].callback_data)), "handled");
  const page = await pgListUpdates(db, "oldest");
  assert.deepEqual(page.map((e) => [e.id, e.tag, new Date(e.ts).toISOString().slice(0, 10)]), [["2026-09-18-panda-goes-live", "new", "2026-09-18"], ["2026-10-09-simpler-draw-your-trade", "improved", "2026-10-09"]]);
  assert.equal((await queued(db, ADMIN_TG)).at(-1)!.text, "✅ WEB: historial publicado en la página Novedades (2 entradas).\nhttps://launchonpanda.app/updates");
  assert.equal((await tgGetChangelog(db, r.id))?.status, "published");
  assert.equal((await queued(db, CHANNEL)).length, 0, "the history is for the web only: nothing goes to the channel");
  assert.equal((await handleChangelogCallback(d, { data: buttons[0][0].callback_data, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "already");
  assert.equal((await pgListUpdates(db)).length, 2);
  assert.ok(d.audits.includes("updates.history.publish"));
});

test("a discarded history adds nothing, and it can't be published afterwards", async () => {
  const { db, d } = await setup();
  const r = await receiveHistory(d, { history: [entry({ date: "2026-09-18" })] });
  if (!r.ok) throw new Error(JSON.stringify(r));
  await handleUpdate(d, press(`${CB_DISCARD}${r.id}`));
  assert.equal((await handleChangelogCallback(d, { data: `${CB_PUBLISH}${r.id}_0`, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "already");
  assert.equal((await pgListUpdates(db)).length, 0);
});

// ── screenshots ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("a screenshot is a file of the site under /updates/; an English one has its Spanish sibling", () => {
  for (const ok of ["/updates/chart-zoom.webp", "/updates/2026-10-11-orders.en.webp", "/updates/a.png", "/updates/b_1.jpg"]) assert.equal(isScreenshotPath(ok), true, ok);
  for (const bad of ["/updates/../admin.webp", "/admin/x.webp", "https://evil.example/x.webp", "/updates/x.svg", "/updates/x.gif", "/updates/.webp", "/updates/a/b.webp", "", null, 5]) assert.equal(isScreenshotPath(bad), false, String(bad));
  assert.equal(localizedImage("/updates/orders.en.webp", "es"), "/updates/orders.es.webp");
  assert.equal(localizedImage("/updates/orders.en.webp", "en"), "/updates/orders.en.webp");
  assert.equal(localizedImage("/updates/chart.webp", "es"), "/updates/chart.webp", "a picture with no text in it is one file");
  assert.deepEqual(imageVariants("/updates/orders.en.webp"), ["/updates/orders.en.webp", "/updates/orders.es.webp"]);
  assert.deepEqual(imageVariants("/updates/chart.webp"), ["/updates/chart.webp"]);

  const good = checkImageAssignments([{ id: "2026-09-18-panda-goes-live", imageUrl: "/updates/home.en.webp" }, { id: "2026-10-01-second-thing", imageUrl: null }]);
  assert.ok(good.ok && good.items.length === 2 && good.items[1].imageUrl === null);
  const problems = (raw: unknown) => {
    const r = checkImageAssignments(raw);
    return r.ok ? "" : r.problems.join(" | ");
  };
  assert.match(problems([]), /no entries/);
  assert.match(problems("x"), /no entries/);
  assert.match(problems([{ id: "../x", imageUrl: "/updates/a.webp" }]), /id isn't valid/);
  assert.match(problems([{ id: "2026-09-18-a", imageUrl: "https://elsewhere.example/a.webp" }]), /under \/updates\//);
  assert.match(problems([{ id: "2026-09-18-a", imageUrl: "/updates/a.webp" }, { id: "2026-09-18-a", imageUrl: "/updates/b.webp" }]), /appears twice/);
  assert.match(problems(Array.from({ length: 61 }, (_, k) => ({ id: `2026-09-18-a${k}`, imageUrl: "/updates/a.webp" }))), /at most 60/);
});

test("a new update's screenshot is SHOWN to the admin with the 🌐 WEB message, before anything is published", async () => {
  const { db, d } = await setup();
  const r = await receiveDraft(d, draft({ web: [entry({ imageUrl: "/updates/orders.en.webp" }), entry({ title: { en: "No picture here", es: "Sin captura" } })] }));
  if (!r.ok) throw new Error(JSON.stringify(r));
  const sent = await queued(db, ADMIN_TG);
  const photos = sent.filter((m) => m.row.method === "sendPhoto").map((m) => m.payload as { photo: string; caption: string });
  assert.deepEqual(photos.map((p) => p.photo), ["https://launchonpanda.app/updates/orders.en.webp", "https://launchonpanda.app/updates/orders.es.webp"], "the English and the Spanish screen");
  assert.match(photos[0].caption, /^<b>🌐 WEB · Captura · 🇬🇧<\/b>\nVentas y stops en el gráfico\nhttps:\/\/launchonpanda\.app\/updates\/orders\.en\.webp$/);
  assert.match(photos[1].caption, /🇪🇸/);
  assert.equal((await pgListUpdates(db)).length, 0, "seeing it is not publishing it");
  // Published with the Telegram draft: the entry carries its picture.
  await handleUpdate(d, press(`${CB_PUBLISH}${r.id}_0`));
  const page = await pgListUpdates(db, "oldest");
  assert.deepEqual(page.map((e) => e.imageUrl), ["/updates/orders.en.webp", null]);
  // One file, one photo; an https picture is shown as it is.
  assert.deepEqual(shotMessages([{ title: "Zoom", imageUrl: "/updates/zoom.webp" }, { title: "Fuera", imageUrl: "https://cdn.example.com/a.png" }], "https://launchonpanda.app/").map((m) => m.photo), ["https://launchonpanda.app/updates/zoom.webp", "https://cdn.example.com/a.png"]);
});

test("screenshots for entries already on the page need the admin's '✅ Publicar capturas' — and only touch the picture", async () => {
  const { db, d } = await setup();
  const clean = (over: Record<string, unknown> = {}): UpdateEntry => {
    const c = checkEntry(entry(over));
    if (!c.ok) throw new Error(c.problems.join());
    return c.entry;
  };
  const [first, second] = await pgAddUpdates(db, [{ ...clean(), ts: NOW - 86_400_000 }, { ...clean({ title: { en: "Second thing", es: "Segunda cosa" } }), ts: NOW }], "history:test", NOW);
  const unknown = await receiveImages(d, { images: [{ id: "2026-01-01-not-there", imageUrl: "/updates/a.webp" }] });
  assert.ok(!unknown.ok && unknown.status === 422 && /there is no entry 2026-01-01-not-there/.test(unknown.problems!.join()));
  const outside = await receiveImages(d, { images: [{ id: first, imageUrl: "/admin/secret.webp" }] });
  assert.ok(!outside.ok && outside.status === 422);

  const r = await receiveImages(d, { images: [{ id: first, imageUrl: "/updates/orders.en.webp" }, { id: second, imageUrl: "/updates/second.webp" }] });
  if (!r.ok) throw new Error(JSON.stringify(r));
  const sent = await queued(db, ADMIN_TG);
  const dm = sent.find((m) => m.row.method === "sendMessage" && /Capturas para 2 entradas/.test(m.text ?? ""))!;
  assert.match(dm.text!, /^<b>🌐 WEB · Historial · Borrador<\/b>\n\nCapturas para 2 entradas que ya están en la página Novedades/);
  assert.match(dm.text!, /🖼 Ventas y stops en el gráfico\n🖼 Segunda cosa$/);
  const buttons = (dm.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
  assert.deepEqual(buttons.map((row) => row.map((b) => b.text)), [["✅ Publicar capturas", "❌ Descartar"]]);
  assert.equal(sent.filter((m) => m.row.method === "sendPhoto").length, 3, "every picture itself: two languages of the first, one of the second");
  assert.deepEqual((await pgListUpdates(db)).map((e) => e.imageUrl), [null, null], "nothing changes before the button");
  assert.equal(await handleUpdate(d, press(buttons[0][0].callback_data, 424242)), "ignored");
  assert.equal(await handleUpdate(d, press(buttons[0][0].callback_data)), "handled");
  const before = await pgGetUpdate(db, first);
  assert.equal(before?.imageUrl, "/updates/orders.en.webp");
  assert.equal((await pgGetUpdate(db, second))?.imageUrl, "/updates/second.webp");
  assert.equal(before?.title.en, "Sell and stop orders on the chart", "texts, tag and date are untouched");
  assert.equal((await pgListUpdates(db)).length, 2);
  assert.ok(d.audits.includes("updates.images.publish"));
  assert.equal((await queued(db, ADMIN_TG)).at(-1)!.text, "✅ WEB: capturas añadidas a la página Novedades (2 entradas).\nhttps://launchonpanda.app/updates");
  assert.equal((await handleChangelogCallback(d, { data: buttons[0][0].callback_data, fromId: ADMIN_TG, chatId: ADMIN_TG })).outcome, "already");
  // null takes a picture away; an id that isn't there changes nothing.
  assert.deepEqual(await pgSetUpdateImages(db, [{ id: second, imageUrl: null }, { id: "2026-01-01-nope", imageUrl: "/updates/a.webp" }]), [second]);
  assert.equal((await pgGetUpdate(db, second))?.imageUrl, null);
});

test("on the page the screenshot sits inside the card, under the text, and a tap shows it large", () => {
  const src = readFileSync("src/components/updates/UpdatesClient.tsx", "utf8");
  const card = src.slice(src.indexOf("export function UpdateCard"));
  assert.ok(card.indexOf("{entry.body[lang] ?? entry.body.en}") < card.indexOf("<Screenshot src={localizedImage(entry.imageUrl, lang)}"), "under the text");
  assert.ok(card.indexOf("<Screenshot") < card.indexOf("<CopyLink"), "inside the card");
  const shot = src.slice(src.indexOf("function Screenshot"), src.indexOf("export function UpdateCard"));
  assert.ok(shot.includes('role="dialog"') && shot.includes('e.key === "Escape"') && shot.includes("onClick={() => setOpen(true)}"));
  assert.ok(shot.includes('loading="lazy"') && shot.includes("onError"), "light to load, and a missing file leaves no broken picture");
});
