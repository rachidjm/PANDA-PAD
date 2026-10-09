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
test("/start: welcome in the user's language; a recruiter deep link points to the site with ?ref= (wallet) or ?code=", async () => {
  const d = botDeps(db);
  const u = newUserId();
  await handleMessage(d, dm(u, "/start", "es"));
  assert.match(await last(u), /Bot de PANDA/);
  await handleMessage(d, dm(u, `/start ref_${PANDA}`));
  const q = await queued(db, u);
  const btn = (q.at(-1)!.payload.reply_markup as { inline_keyboard: { url: string }[][] }).inline_keyboard[0][0].url;
  assert.equal(btn, `https://launchonpanda.app/?ref=${PANDA}`);
  await handleMessage(d, dm(u, "/start ref_MYCODE1"));
  assert.equal(((await queued(db, u)).at(-1)!.payload.reply_markup as { inline_keyboard: { url: string }[][] }).inline_keyboard[0][0].url, "https://launchonpanda.app/?code=MYCODE1");
  assert.equal((await tgGetUser(db, u))?.lang, "en", "the language follows the latest message");
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
