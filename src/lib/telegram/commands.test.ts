import { tgCounter, tgStats } from "@/lib/db/telegram";
import { WEB_START_COUNTER } from "./commands";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgGetUser, tgSuggestionsSince } from "@/lib/db/telegram";
import { handleMessage, parseCommand } from "./commands";
import { evaluateAlerts, parseAlertSpec } from "./alerts";
import { handleUpdate, secretMatches } from "./bot";
import { parseUpdate } from "./updates";
import { ADMIN_TG, botDeps, coin, dm, fakeMarket, inGroup, newUserId, OTHER, PANDA, queued } from "./testing";
import { telegramConfig } from "./config";

let db: Db;
before(async () => {
  db = await newTestDb();
});

const last = async (chat: number) => (await queued(db, chat)).at(-1)?.text ?? "";

// ── parsing ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test("commands: /cmd@ThisBot is ours, /cmd@OtherBot is not, plain text is not a command", () => {
  assert.deepEqual(parseCommand("/token@PandaTestBot abc", "PandaTestBot")?.args, ["abc"]);
  assert.equal(parseCommand("/token@OtherBot abc", "PandaTestBot")?.forMe, false);
  assert.equal(parseCommand("hello there", "PandaTestBot"), null);
  assert.equal(parseCommand("/start", null)?.forMe, true);
});

test("updates: malformed, bot senders, huge texts and non-message updates are refused or ignored", () => {
  assert.equal(parseUpdate(null).kind, "invalid");
  assert.equal(parseUpdate({ update_id: "1" }).kind, "invalid");
  assert.equal(parseUpdate({ update_id: 1 }).kind, "ignored");
  const base = { update_id: 2, message: { chat: { id: 7, type: "private" }, from: { id: 7, language_code: "es" }, text: "/help" } };
  const ok = parseUpdate(base);
  assert.equal(ok.kind, "message");
  if (ok.kind === "message") assert.equal(ok.message.lang, "es");
  assert.equal(parseUpdate({ ...base, message: { ...base.message, from: { id: 7, is_bot: true } } }).kind, "ignored");
  assert.equal(parseUpdate({ ...base, message: { ...base.message, text: "x".repeat(4097) } }).kind, "ignored");
  assert.equal(parseUpdate({ ...base, message: { ...base.message, chat: { id: 7, type: "weird" } } }).kind, "ignored");
  const fwd = parseUpdate({ update_id: 3, message: { chat: { id: 7, type: "private" }, from: { id: 7 }, forward_origin: { type: "channel", chat: { id: -100555, title: "PANDA" } } } });
  assert.equal(fwd.kind, "forwarded_channel");
});

test("webhook secret: only the exact configured value passes; no secret configured means nothing passes", () => {
  assert.equal(secretMatches("s".repeat(40), "s".repeat(40)), true);
  assert.equal(secretMatches("s".repeat(39), "s".repeat(40)), false);
  assert.equal(secretMatches(null, "s".repeat(40)), false);
  assert.equal(secretMatches("anything", null), false);
});

test("an update is handled once: Telegram re-sending the same update_id gets no second answer", async () => {
  const d = botDeps(db);
  const u = newUserId();
  const raw = { update_id: 900_001, message: { chat: { id: u, type: "private" }, from: { id: u }, text: "/help" } };
  assert.equal(await handleUpdate(d, raw), "handled");
  assert.equal(await handleUpdate(d, raw), "duplicate");
  assert.equal((await queued(db, u)).length, 1);
});

// ── commands ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type Markup = { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] };
const buttonsOf = (q: { payload: Record<string, unknown> }) => ((q.payload.reply_markup as Markup | undefined)?.inline_keyboard ?? []).map((row) => row[0]);

test("/start: a short welcome in the user's language with the four buttons — community, channel, open PANDA, how alerts work", async () => {
  const d = botDeps(db);
  const u = newUserId();
  await handleMessage(d, dm(u, "/start"));
  const en = (await queued(db, u)).at(-1)!;
  assert.match(en.text, /Welcome to PANDA[\s\S]*launchpad for Solana coins[\s\S]*Not financial advice/);
  assert.deepEqual(buttonsOf(en), [
    { text: "💬 Join the Community", url: "https://t.me/pandacommunity" },
    { text: "📢 Updates channel", url: "https://t.me/pandaupdates" },
    { text: "🌐 Open PANDA", url: "https://launchonpanda.app" },
    { text: "🔔 How alerts work", callback_data: "help" },
  ]);
  await handleMessage(d, dm(u, "/start", "es"));
  const es = (await queued(db, u)).at(-1)!;
  assert.match(es.text, /Bienvenido a PANDA/);
  assert.deepEqual(buttonsOf(es).map((b) => b.text), ["💬 Únete a la comunidad", "📢 Canal de novedades", "🌐 Abrir PANDA", "🔔 Cómo funcionan las alertas"]);
  assert.equal((await tgGetUser(db, u))?.lang, "es", "the language follows the latest message");
});

test("/start without TELEGRAM_GROUP_URL / TELEGRAM_CHANNEL_URL: those two buttons simply aren't there", async () => {
  const u = newUserId();
  const d = botDeps(db);
  d.cfg = { ...d.cfg, groupUrl: null, channelUrl: null };
  await handleMessage(d, dm(u, "/start"));
  assert.deepEqual(buttonsOf((await queued(db, u)).at(-1)!).map((b) => b.text), ["🌐 Open PANDA", "🔔 How alerts work"]);
  assert.equal(telegramConfig({ TELEGRAM_GROUP_URL: "http://t.me/x", TELEGRAM_CHANNEL_URL: "https://evil.example/x" }).groupUrl, null, "only https://t.me links are accepted");
  assert.equal(telegramConfig({ TELEGRAM_GROUP_URL: "https://t.me/+AbCdEf123" }).groupUrl, "https://t.me/+AbCdEf123");
});

test("/start with a recruiter deep link: the recruiter flow comes FIRST (?ref= for a wallet, ?code= for a code), then the welcome and its buttons", async () => {
  const d = botDeps(db);
  const u = newUserId();
  await handleMessage(d, dm(u, `/start ref_${PANDA}`));
  let q = await queued(db, u);
  assert.equal(q.length, 2);
  assert.match(q[0].text, /recruiter link/);
  assert.equal(buttonsOf(q[0])[0].url, `https://launchonpanda.app/?ref=${PANDA}`);
  assert.match(q[1].text, /Welcome to PANDA/);
  assert.equal(buttonsOf(q[1]).length, 4);
  await handleMessage(d, dm(u, "/start ref_MYCODE1"));
  q = await queued(db, u);
  assert.equal(buttonsOf(q[2])[0].url, "https://launchonpanda.app/?code=MYCODE1");
  assert.match(q[3].text, /Welcome to PANDA/);
});

test("/start link: the wallet-linking flow comes FIRST (a one-time link), then the welcome and its buttons", async () => {
  const d = botDeps(db);
  const u = newUserId();
  await handleMessage(d, dm(u, "/start link"));
  const q = await queued(db, u);
  assert.equal(q.length, 2);
  assert.match(buttonsOf(q[0])[0].url!, /^https:\/\/launchonpanda\.app\/telegram\/link\?code=[A-Za-z0-9_-]{24}$/);
  assert.match(q[0].text, /NEVER ask for your seed phrase/);
  assert.match(q[1].text, /Welcome to PANDA/);
});

test("the 'How alerts work' button shows /help, is acknowledged to Telegram, and any other button data does nothing", async () => {
  const u = newUserId();
  const acked: string[] = [];
  const d = botDeps(db, { answerCallback: async (id) => void acked.push(id) });
  const press = (id: number, data: string) => ({ update_id: id, callback_query: { id: `cb${id}`, from: { id: u, language_code: "es" }, data, message: { message_id: 5, chat: { id: u, type: "private" } } } });
  assert.equal(await handleUpdate(d, press(910_001, "help")), "handled");
  assert.match(await last(u), /Comandos:[\s\S]*\/alert/);
  assert.equal(await handleUpdate(d, press(910_002, "other")), "ignored");
  assert.equal(await handleUpdate(d, press(910_003, "DROP TABLE")), "ignored");
  assert.deepEqual(acked, ["cb910001", "cb910002"], "valid presses are acknowledged; malformed data isn't even parsed");
  assert.equal((await queued(db, u)).length, 1);
  assert.equal(parseUpdate({ update_id: 1, callback_query: { id: "x", from: { id: 1, is_bot: true }, data: "help", message: { chat: { id: 1, type: "private" } } } }).kind, "ignored");
});

test("/help, /new (none yet and with launches), /trending: real data or an honest 'unavailable'", async () => {
  const u = newUserId();
  await handleMessage(botDeps(db), dm(u, "/help"));
  assert.match(await last(u), /seed phrase/);
  await handleMessage(botDeps(db), dm(u, "/new"));
  assert.match(await last(u), /No coin has been launched on PANDA yet/);
  const withLaunch = fakeMarket({ pandaLaunches: async () => [{ ...coin(PANDA, { ticker: "PANDA", name: "PANDA" }), launchedAt: 1 }] });
  await handleMessage(botDeps(db, { market: withLaunch }), dm(u, "/new"));
  assert.match(await last(u), /\$PANDA/);
  await handleMessage(botDeps(db), dm(u, "/trending"));
  assert.match(await last(u), /24h volume/);
  assert.match(await last(u), /not a recommendation/);
  const down = fakeMarket({ mostTraded: async () => { throw new Error("down"); } });
  await handleMessage(botDeps(db, { market: down }), dm(u, "/trending"));
  assert.match(await last(u), /isn't available/);
});

test("/token: by address; 'PANDA' always the official mint; an ambiguous ticker lists addresses with a warning", async () => {
  const u = newUserId();
  await handleMessage(botDeps(db), dm(u, `/token ${OTHER}`));
  assert.match(await last(u), /Market cap/);
  assert.match(await last(u), /Not financial advice/);
  await handleMessage(botDeps(db), dm(u, "/token $panda"));
  assert.match(await last(u), new RegExp(PANDA));
  assert.match(await last(u), /official/);
  const lookalikes = fakeMarket({ search: async () => [coin("A1".padEnd(44, "1"), { ticker: "CAT" }), coin("B2".padEnd(44, "2"), { ticker: "CAT" })] });
  await handleMessage(botDeps(db, { market: lookalikes }), dm(u, "/token CAT"));
  assert.match(await last(u), /tickers are not unique/);
  await handleMessage(botDeps(db), dm(u, "/token"));
  assert.match(await last(u), /Usage/);
});

test("personal commands only in private: in the group they answer with a link to the private chat", async () => {
  const u = newUserId();
  await handleMessage(botDeps(db), inGroup(u, "/alert x price above 1"));
  assert.match((await queued(db, -1002)).at(-1)!.text, /private chat/);
  await handleMessage(botDeps(db), inGroup(u, "/token@OtherBot x"));
  assert.match((await queued(db, -1002)).at(-1)!.text, /private chat/, "a command for another bot is ignored (nothing new)");
});

test("/watch, /unwatch, /watchlist: addresses only, no duplicates, a cap of 20", async () => {
  const u = newUserId();
  const d = botDeps(db);
  await handleMessage(d, dm(u, "/watch CAT"));
  assert.match(await last(u), /addresses only/);
  await handleMessage(d, dm(u, `/watch ${OTHER}`));
  assert.match(await last(u), /Added/);
  await handleMessage(d, dm(u, `/watch ${OTHER}`));
  assert.match(await last(u), /already/);
  await handleMessage(d, dm(u, "/watchlist"));
  assert.match(await last(u), /Your watchlist/);
  await handleMessage(d, dm(u, `/unwatch ${OTHER}`));
  assert.match(await last(u), /Removed/);
  await handleMessage(d, dm(u, "/watchlist"));
  assert.match(await last(u), /empty/);
});

test("/alert: parses price|mcap above|below with k/m, refuses a level already reached, caps at 10, /alerts and remove", async () => {
  assert.deepEqual(parseAlertSpec(["mcap", "above", "1.5m"]), { metric: "mcap", direction: "above", value: 1_500_000 });
  assert.deepEqual(parseAlertSpec(["price", "below", "0,0005"]), { metric: "price", direction: "below", value: 0.0005 });
  assert.equal(parseAlertSpec(["mcap", "sideways", "1"]), null);
  assert.equal(parseAlertSpec(["price", "above", "-1"]), null);
  const u = newUserId();
  const d = botDeps(db);
  await handleMessage(d, dm(u, `/alert ${OTHER} mcap above 10k`));
  assert.match(await last(u), /already true/, "mcap is 50k: 'above 10k' would fire at once");
  for (let i = 1; i <= 10; i++) await handleMessage(d, dm(u, `/alert ${OTHER} mcap above ${100 + i}k`));
  assert.match(await last(u), /Alert set/);
  await handleMessage(d, dm(u, `/alert ${OTHER} mcap above 999k`));
  assert.match(await last(u), /maximum/);
  await handleMessage(d, dm(u, "/alerts"));
  assert.match(await last(u), /^🔔/);
  await handleMessage(d, dm(u, "/alert remove 1"));
  assert.match(await last(u), /removed/);
  await handleMessage(d, dm(u, "/alert remove 99"));
  assert.match(await last(u), /Usage/);
});

test("alerts fire ONCE by private message, never on a missing number, and not before the level is crossed", async () => {
  const u = newUserId();
  const coins = { [OTHER]: coin(OTHER, { marketCap: 50_000 }) };
  const d = botDeps(db, { market: fakeMarket({ coins }) });
  await handleMessage(d, dm(u, `/alert ${OTHER} mcap above 60k`));
  const before = (await queued(db, u)).length;
  // Not crossed yet.
  await evaluateAlerts({ db, market: fakeMarket({ coins }), now: d.now });
  assert.equal((await queued(db, u)).length, before);
  // No number for the coin this round: nothing fires.
  await evaluateAlerts({ db, market: fakeMarket({ coins, quotesMap: new Map() }), now: d.now });
  assert.equal((await queued(db, u)).length, before);
  // Crossed: fires once…
  const up = fakeMarket({ coins: { [OTHER]: coin(OTHER, { marketCap: 70_000 }) } });
  await evaluateAlerts({ db, market: up, now: d.now });
  await evaluateAlerts({ db, market: up, now: d.now });
  const after = await queued(db, u);
  assert.equal(after.length, before + 1, "…and only once, however many runs see it crossed");
  assert.match(after.at(-1)!.text, /now above/);
  await handleMessage(d, dm(u, "/alerts"));
  assert.match(await last(u), /no active alerts/);
});

test("/suggest saves the text (max 1000 chars, 5 a day); /chatid and /stats answer admins only", async () => {
  const u = newUserId();
  const d = botDeps(db);
  await handleMessage(d, dm(u, "/suggest"));
  assert.match(await last(u), /Usage/);
  await handleMessage(d, dm(u, `/suggest ${"x".repeat(1001)}`));
  assert.match(await last(u), /Usage/);
  for (let i = 0; i < 5; i++) await handleMessage(d, dm(u, `/suggest idea ${i}`));
  assert.equal(await tgSuggestionsSince(db, u, 0), 5);
  await handleMessage(d, dm(u, "/suggest one more"));
  assert.match(await last(u), /several suggestions/);

  const n = (await queued(db, u)).length;
  await handleMessage(d, dm(u, "/chatid"));
  await handleMessage(d, dm(u, "/stats"));
  assert.equal((await queued(db, u)).length, n, "not an admin: no answer at all");
  await handleMessage(d, inGroup(ADMIN_TG, "/chatid", 42));
  assert.match((await queued(db, -1002)).at(-1)!.text, /-1002[\s\S]*42/);
  await handleMessage(d, dm(ADMIN_TG, "/stats"));
  assert.match(await last(ADMIN_TG), /Users: \d+/);
});

test("rate limit per Telegram user: over it, one short notice and then silence", async () => {
  const u = newUserId();
  let calls = 0;
  const d = botDeps(db, { isLimited: async (key) => (key.startsWith("tg:user:") ? true : calls++ > 0) });
  await handleMessage(d, dm(u, "/help"));
  await handleMessage(d, dm(u, "/help"));
  const q = await queued(db, u);
  assert.equal(q.length, 1);
  assert.match(q[0].text, /Too many messages/);
});

test("/start web (the website's button) and /start with any unknown parameter: the normal welcome with its buttons, once, no error — and web starts are counted", async () => {
  const d = botDeps(db);
  const before = await tgCounter(db, WEB_START_COUNTER);
  for (const [text, counted] of [["/start web", 1], ["/start whatever_else", 0], ["/start ../../etc 😀", 0], ["/start web", 1]] as const) {
    const u = newUserId();
    const was = await tgCounter(db, WEB_START_COUNTER);
    await handleMessage(d, dm(u, text));
    const q = await queued(db, u);
    assert.equal(q.length, 1, `${text}: exactly one message`);
    assert.match(q[0].text, /Welcome to PANDA/);
    assert.deepEqual(buttonsOf(q[0]).map((b) => b.text), ["💬 Join the Community", "📢 Updates channel", "🌐 Open PANDA", "🔔 How alerts work"]);
    assert.equal((await tgCounter(db, WEB_START_COUNTER)) - was, counted, text);
  }
  assert.equal((await tgCounter(db, WEB_START_COUNTER)) - before, 2);
  assert.equal((await tgStats(db)).startsWeb, await tgCounter(db, WEB_START_COUNTER));
});
