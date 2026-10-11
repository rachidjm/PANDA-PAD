import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgGetLinkCode } from "@/lib/db/telegram";
import { handleMessage } from "./commands";
import { hashLinkCode } from "./link";
import { LINK_LIMIT, LINK_WAIT_MINUTES, LINK_WINDOW_MS, linkPageUrl } from "./link-limit";
import { issueSession } from "./miniapp";
import { botDeps, dm, newUserId, queued } from "./testing";

/**
 * Linking a wallet from the Mini App's first screen, and the bot's limit on link requests: the app asks the server for
 * the link itself (nothing is sent to the bot), only asking for a link counts, and the message says how long to wait.
 */

const TOKEN = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ON = { FEATURE_TELEGRAM_BOT: "true", FEATURE_TELEGRAM_MINIAPP: "true", TELEGRAM_BOT_TOKEN: TOKEN };
let db: Db;
before(async () => {
  db = await newTestDb();
});

/** The limiter as the bot sees it, recording what was counted. */
function limiter(limitedKeys: string[] = []) {
  const calls: [string, number, number][] = [];
  return { calls, isLimited: async (key: string, max: number, windowMs: number) => (calls.push([key, max, windowMs]), limitedKeys.includes(key)) };
}

test("the limit is 5 links in 10 minutes, and the page a link opens is the same from the bot and from the app", () => {
  assert.equal(LINK_LIMIT, 5);
  assert.equal(LINK_WINDOW_MS, 10 * 60_000);
  assert.equal(LINK_WAIT_MINUTES, 10);
  assert.equal(linkPageUrl("https://launchonpanda.app/", "abc"), "https://launchonpanda.app/telegram/link?code=abc");
});

test("a plain /start never counts towards the link limit; /link and 'start link' do", async () => {
  const who = newUserId();
  const l = limiter();
  const d = botDeps(db, { isLimited: l.isLimited });
  for (let i = 0; i < 8; i++) await handleMessage(d, dm(who, "/start"));
  await handleMessage(d, dm(who, "/start web"));
  await handleMessage(d, dm(who, "/help"));
  assert.deepEqual(l.calls.filter(([k]) => k.startsWith("tg:link:")), [], "eight /start in a row asked for no link and used none of the allowance");
  assert.ok(!(await queued(db, who)).some((m) => /several links|varios enlaces/.test(m.text)));

  await handleMessage(d, dm(who, "/link"));
  await handleMessage(d, dm(who, "/start link"));
  assert.deepEqual(l.calls.filter(([k]) => k.startsWith("tg:link:")), [[`tg:link:${who}`, 5, 600_000], [`tg:link:${who}`, 5, 600_000]]);
});

test("over the limit, the bot says how long to wait — in the user's language — and makes no link", async () => {
  for (const [lang, expected] of [["en", "Wait about 10 minutes"], ["es", "Espera unos 10 minutos"]] as const) {
    const who = newUserId();
    const d = botDeps(db, { isLimited: limiter([`tg:link:${who}`]).isLimited });
    await handleMessage(d, dm(who, "/link", lang));
    const sent = await queued(db, who);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes(expected), sent[0].text);
    assert.ok(!JSON.stringify(sent[0].payload).includes("/telegram/link?code="), "no link was made");
  }
});

test("'Link my wallet' in the app: the server hands over the one-time link for THAT Telegram account, and the bot is sent nothing", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, ON);
  setDbForTests(db);
  try {
    const { POST } = (await import("@/app/api/tg/link/route")) as { POST: (req: Request) => Promise<Response> };
    const who = newUserId() + 900_000;
    const auth = { Authorization: `Bearer ${issueSession(who, TOKEN, Date.now()).token}`, "Content-Type": "application/json" };
    const res = await POST(new Request("https://launchonpanda.app/api/tg/link", { method: "POST", headers: auth }));
    assert.equal(res.status, 200);
    const data = (await res.json()) as { url: string; expiresAt: number };
    const m = /\/telegram\/link\?code=([A-Za-z0-9_-]{24})$/.exec(data.url);
    assert.ok(m, data.url);
    // The code is a real /link code, and it is this account's.
    const rec = await tgGetLinkCode(db, hashLinkCode(m[1]));
    assert.equal(rec?.telegramId, who);
    assert.equal(rec?.usedAt, null);
    assert.deepEqual(await queued(db, who), [], "no message to or from the bot");

    // Without the Telegram session there is no link; and with the app off the route does not exist.
    assert.equal((await POST(new Request("https://launchonpanda.app/api/tg/link", { method: "POST" }))).status, 401);
    const forged = createHmac("sha256", "x").update("y").digest("base64url");
    assert.equal((await POST(new Request("https://launchonpanda.app/api/tg/link", { method: "POST", headers: { Authorization: `Bearer v1.${who}.${Date.now() + 60_000}.${forged}` } }))).status, 401);
    process.env.FEATURE_TELEGRAM_MINIAPP = "false";
    assert.equal((await POST(new Request("https://launchonpanda.app/api/tg/link", { method: "POST", headers: auth }))).status, 404);
  } finally {
    setDbForTests(null);
    for (const k of Object.keys(ON)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("the first screen: a button that opens the link page itself, a check that asks the server, and it signs in by itself once linked", () => {
  const shell = readFileSync("src/components/tg/TgShell.tsx", "utf8");
  // Nothing in the app sends the user to the bot to link (that is what made the bot receive /start again and again).
  for (const f of ["TgShell.tsx", "TgCoin.tsx", "TgCreate.tsx", "TgConnect.tsx", "TgScreens.tsx"]) assert.doesNotMatch(readFileSync(`src/components/tg/${f}`, "utf8"), /\?start=link/, f);
  const open = shell.slice(shell.indexOf("  function openLinkPage()"), shell.indexOf("  /** \"I've linked it"));
  assert.ok(open.includes("openExternal(ready.url);") && open.indexOf("openExternal(ready.url);") < open.indexOf("fetchLink()"), "the link asked for ahead of time is opened inside the tap, with Telegram's own method");
  assert.ok(shell.includes('api("/api/tg/link", { method: "POST" })') && shell.includes("have.expiresAt - Date.now() > 60_000"), "one link while it is valid, however many taps");
  // "I've linked it · check": the server is asked; linked means signed in at once, not linked is said.
  const check = shell.slice(shell.indexOf("  async function checkLinked()"), shell.indexOf("  /** Is the session still live?"));
  assert.ok(check.includes("const w = await refreshWallet();") && check.includes("await startLogin();") && check.includes('"tg.login.linkNone"'));
  // And without pressing anything: asked every few seconds while that screen is up.
  assert.ok(shell.includes("if (await refreshWallet()) await startLogin();") && shell.includes("setInterval(look, 4_000)"));
  // The same limit as /link, shared with it.
  const route = readFileSync("src/app/api/tg/link/route.ts", "utf8");
  assert.ok(route.includes("rateLimited(`tg:link:${g.telegramId}`, LINK_LIMIT, LINK_WINDOW_MS)") && route.includes('appGate(req, 20, "link")'));
});

test("the page after the wallet only brings Telegram back to the front: it never opens the Mini App again", () => {
  const page = readFileSync("src/app/telegram/wallet/[[...slug]]/page.tsx", "utf8");
  const client = readFileSync("src/components/tg/TgWalletReturn.tsx", "utf8");
  assert.ok(client.includes('export const BACK_TO_TELEGRAM = "tg://resolve";'));
  for (const src of [page, client]) assert.doesNotMatch(src.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, ""), /startapp|t\.me\/|redirect\(/, "no link that starts the Mini App, and no redirect to one");
  // The server keeps the wallet's answer while building the page, so the page can leave at once, by itself.
  assert.ok(page.includes(".then(() => leaveRelayAnswer(getDb(), where.relayId, answer))") && page.includes('.catch(() => "invalid" as const)') && page.includes("<TgWalletReturn stored={stored} />"));
  assert.ok(client.includes("if (stored) {\n      goBack();") && client.includes("<a href={BACK_TO_TELEGRAM}"));
  // The Mini App that stayed open collects the answer the moment it is back on screen, however long the user was away.
  const adapter = readFileSync("src/lib/wallet/deeplink/adapter.ts", "utf8");
  const collect = adapter.slice(adapter.indexOf("  private async collect("));
  assert.ok(collect.includes("await untilVisibleOr(RELAY_POLL_MS);") && collect.indexOf("b.api(`/api/tg/relay?id=${relayId}`)") < collect.indexOf('if (late) throw new DeepLinkFlowError("timeout"'), "asked once more before giving up");
});
