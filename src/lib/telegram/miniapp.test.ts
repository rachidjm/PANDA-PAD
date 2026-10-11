import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgGetState, tgSetState } from "@/lib/db/telegram";
import { buildCsp } from "@/lib/security/csp";
import { MAX_ALERTS, MAX_WATCH } from "./alerts";
import { startButtons } from "./commands";
import { telegramConfig } from "./config";
import {
  appAddAlert,
  appAlerts,
  appDeleteAlert,
  appUnwatch,
  appWatch,
  appWatchlist,
  cleanRelayAnswer,
  INIT_DATA_MAX_AGE_MS,
  isRelayId,
  issueSession,
  miniappEnabled,
  readSession,
  relayKey,
  SESSION_TTL_MS,
  sessionOf,
  verifyInitData,
  type RelaySlot,
} from "./miniapp";
import { coin, fakeMarket, newUserId, OTHER, PANDA, testConfig } from "./testing";

/** The Telegram Mini App's server side: who is asking is proven by Telegram's signature, never by the browser's word. */

const TOKEN = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = 1_800_000_000_000;
const ON = { FEATURE_TELEGRAM_BOT: "true", FEATURE_TELEGRAM_MINIAPP: "true", TELEGRAM_BOT_TOKEN: TOKEN };

/** What Telegram does: sign every field (sorted, joined by "\n") with HMAC(HMAC("WebAppData", token)). */
function signInitData(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const user = (over: Record<string, unknown> = {}) => JSON.stringify({ id: 777001, first_name: "Ana", language_code: "es-ES", ...over });
const fields = (over: Record<string, string> = {}) => ({ auth_date: String(Math.floor(NOW / 1000) - 30), query_id: "AAE1", user: user(), ...over });

test("the app is on only with the bot on, its own flag on and a token — and FEATURE_TELEGRAM_MINIAPP is off unless it is exactly 'true'", () => {
  assert.equal(miniappEnabled(ON), true);
  assert.equal(miniappEnabled({}), false);
  assert.equal(miniappEnabled({ ...ON, FEATURE_TELEGRAM_MINIAPP: "1" }), false);
  assert.equal(miniappEnabled({ ...ON, FEATURE_TELEGRAM_BOT: undefined }), false);
  assert.equal(miniappEnabled({ ...ON, TELEGRAM_BOT_TOKEN: " " }), false);
});

test("initData: Telegram's own signature is checked (HMAC), and only its real user is believed", () => {
  const ok = verifyInitData(signInitData(fields()), TOKEN, NOW);
  assert.ok(ok.ok);
  assert.deepEqual(ok.user, { id: 777001, lang: "es", firstName: "Ana" });

  // Changing ANY field after Telegram signed it breaks the signature — the user id above all.
  const forged = new URLSearchParams(signInitData(fields()));
  forged.set("user", user({ id: 1 }));
  assert.deepEqual(verifyInitData(forged.toString(), TOKEN, NOW), { ok: false, error: "invalid" });
  // Signed with another bot's token: not ours.
  assert.deepEqual(verifyInitData(signInitData(fields(), "999:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"), TOKEN, NOW), { ok: false, error: "invalid" });
  // No hash, a malformed one, nothing at all, absurd sizes.
  for (const bad of ["", "user=x", new URLSearchParams(fields()).toString(), 12, null, "a".repeat(5000)]) {
    assert.equal(verifyInitData(bad, TOKEN, NOW).ok, false, String(bad).slice(0, 30));
  }
  // A bot, a user without a numeric id.
  assert.equal(verifyInitData(signInitData(fields({ user: user({ is_bot: true }) })), TOKEN, NOW).ok, false);
  assert.equal(verifyInitData(signInitData(fields({ user: user({ id: "777001" }) })), TOKEN, NOW).ok, false);
  assert.equal(verifyInitData(signInitData(fields({ user: "not json" })), TOKEN, NOW).ok, false);
});

test("initData expires: an hour after Telegram issued it, it is refused even with a perfect signature", () => {
  const at = (msAgo: number) => signInitData(fields({ auth_date: String(Math.floor((NOW - msAgo) / 1000)) }));
  assert.equal(verifyInitData(at(INIT_DATA_MAX_AGE_MS - 5_000), TOKEN, NOW).ok, true);
  assert.deepEqual(verifyInitData(at(INIT_DATA_MAX_AGE_MS + 5_000), TOKEN, NOW), { ok: false, error: "expired" });
  // A date from the future is not "fresh": it is wrong.
  assert.deepEqual(verifyInitData(at(-10 * 60_000), TOKEN, NOW), { ok: false, error: "invalid" });
  assert.equal(verifyInitData(signInitData(fields({ auth_date: "soon" })), TOKEN, NOW).ok, false);
});

test("PANDA's session: signed by the server, names a Telegram account, expires, and can't be edited", () => {
  const s = issueSession(777001, TOKEN, NOW);
  assert.equal(s.expiresAt, NOW + SESSION_TTL_MS);
  assert.deepEqual(readSession(s.token, TOKEN, NOW + 1000), { telegramId: 777001, expiresAt: s.expiresAt });
  assert.equal(readSession(s.token, TOKEN, s.expiresAt + 1), null, "expired");
  assert.equal(readSession(s.token.replace("777001", "777002"), TOKEN, NOW), null, "another account's id under the same signature");
  assert.equal(readSession(s.token.replace(String(s.expiresAt), String(s.expiresAt + 9_999_999)), TOKEN, NOW), null, "a longer life under the same signature");
  assert.equal(readSession(s.token, "999:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", NOW), null, "another token's key");
  for (const bad of ["", "v1.1.2.x", null, 5, "a".repeat(300)]) assert.equal(readSession(bad, TOKEN, NOW), null);

  const req = (auth?: string) => new Request("https://launchonpanda.app/api/tg/watchlist", auth ? { headers: { Authorization: auth } } : {});
  assert.deepEqual(sessionOf(req(`Bearer ${s.token}`), ON, NOW), { telegramId: 777001, expiresAt: s.expiresAt });
  assert.equal(sessionOf(req(), ON, NOW), null);
  assert.equal(sessionOf(req(s.token), ON, NOW), null, "not a Bearer header");
  assert.equal(sessionOf(req(`Bearer ${s.token}`), { ...ON, FEATURE_TELEGRAM_MINIAPP: "false" }, NOW), null, "with the flag off no session is worth anything");
});

test("with the flag off the Mini App does not exist: every /api/tg route answers 404 and the page tree is closed", async () => {
  assert.equal(miniappEnabled(), false, "the test environment has the flag off, as production does");
  const routes = ["session", "coins", "watchlist", "alerts", "relay"];
  for (const r of routes) {
    const mod = (await import(`@/app/api/tg/${r}/route`)) as Record<string, (req: Request) => Promise<Response>>;
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      if (!mod[method]) continue;
      const res = await mod[method](new Request(`https://launchonpanda.app/api/tg/${r}`, { method, headers: { Authorization: `Bearer ${issueSession(1, TOKEN, Date.now()).token}` }, ...(method === "GET" ? {} : { body: "{}" }) }));
      assert.equal(res.status, 404, `${method} /api/tg/${r}`);
    }
  }
  assert.match(readFileSync("src/app/tg/layout.tsx", "utf8"), /if \(!miniappEnabled\(\)\) notFound\(\);/);
  assert.match(readFileSync("src/app/telegram/wallet/[[...slug]]/page.tsx", "utf8"), /if \(!miniappEnabled\(\)\) notFound\(\);/);
});

let db: Db;
before(async () => {
  db = await newTestDb();
});
const deps = (over: Parameters<typeof fakeMarket>[0] = {}) => ({ db, market: fakeMarket(over), now: () => NOW });

test("watchlist: the bot's own list and rules — addresses only, known coins only, no duplicates, the same cap", async () => {
  const u = newUserId();
  const d = deps();
  assert.deepEqual(await appWatchlist(d, u), []);
  assert.deepEqual(await appWatch(d, u, "CAT"), { ok: false, error: "invalid" });
  const { Keypair } = await import("@solana/web3.js");
  assert.deepEqual(await appWatch(d, u, Keypair.generate().publicKey.toBase58()), { ok: false, error: "not_found" }, "a coin no source knows");
  const added = await appWatch(d, u, OTHER);
  assert.ok(added.ok && added.item.ticker === "TST");
  assert.deepEqual(await appWatch(d, u, OTHER), { ok: false, error: "exists" });
  const list = await appWatchlist(d, u);
  assert.deepEqual(
    list.map((x) => [x.mint, x.ticker]),
    [[OTHER, "TST"]]
  );
  // Another account's list is its own.
  assert.deepEqual(await appWatchlist(d, newUserId()), []);
  assert.deepEqual(await appUnwatch(d, u, OTHER), { ok: true });
  assert.deepEqual(await appUnwatch(d, u, OTHER), { ok: false, error: "not_found" });

  // The cap is the bot's (MAX_WATCH).
  const many: Record<string, ReturnType<typeof coin>> = {};
  const mints = Array.from({ length: MAX_WATCH + 1 }, () => Keypair.generate().publicKey.toBase58());
  for (const m of mints) many[m] = coin(m);
  const full = deps({ coins: many });
  for (const m of mints.slice(0, MAX_WATCH)) assert.equal((await appWatch(full, u, m)).ok, true);
  assert.deepEqual(await appWatch(full, u, mints[MAX_WATCH]), { ok: false, error: "full" });
});

test("alerts: the bot's own rules — valid numbers only, never one that is already true, the same cap, only your own can be deleted", async () => {
  const u = newUserId();
  const d = deps({ coins: { [PANDA]: coin(PANDA, { ticker: "PANDA", priceUsd: 0.01, marketCap: 1_000_000 }) } });
  for (const bad of [
    { mint: "x", metric: "price", direction: "above", value: 1 },
    { mint: PANDA, metric: "volume", direction: "above", value: 1 },
    { mint: PANDA, metric: "price", direction: "sideways", value: 1 },
    { mint: PANDA, metric: "price", direction: "above", value: "1" },
    { mint: PANDA, metric: "price", direction: "above", value: -1 },
    { mint: PANDA, metric: "price", direction: "above", value: Infinity },
  ]) {
    assert.deepEqual(await appAddAlert(d, u, bad), { ok: false, error: "invalid" }, JSON.stringify(bad));
  }
  assert.deepEqual(await appAddAlert(d, u, { mint: PANDA, metric: "price", direction: "above", value: 0.005 }), { ok: false, error: "already_true", current: 0.01 });
  assert.deepEqual(await appAddAlert(d, u, { mint: PANDA, metric: "mcap", direction: "below", value: 2_000_000 }), { ok: false, error: "already_true", current: 1_000_000 });
  const made = await appAddAlert(d, u, { mint: PANDA, metric: "price", direction: "above", value: 0.02 });
  assert.ok(made.ok && made.alert.ticker === "PANDA" && made.alert.value === 0.02);
  assert.equal((await appAlerts(d, u)).length, 1);

  const other = newUserId();
  assert.deepEqual(await appDeleteAlert(d, other, made.ok ? made.alert.id : ""), { ok: false, error: "not_found" }, "someone else's alert");
  assert.deepEqual(await appDeleteAlert(d, u, made.ok ? made.alert.id : ""), { ok: true });
  assert.deepEqual(await appAlerts(d, u), []);

  for (let i = 0; i < MAX_ALERTS; i++) assert.equal((await appAddAlert(d, u, { mint: PANDA, metric: "price", direction: "above", value: 0.02 + i })).ok, true);
  assert.deepEqual(await appAddAlert(d, u, { mint: PANDA, metric: "price", direction: "above", value: 99 }), { ok: false, error: "full" });
});

test("the wallet relay only ever stores what a wallet's redirect carries — short, encrypted fields — and its ids can't be guessed", async () => {
  assert.equal(isRelayId("a".repeat(32)), true);
  for (const bad of ["a".repeat(31), "a".repeat(33), "a/".repeat(16), "", null, 7]) assert.equal(isRelayId(bad), false);
  assert.deepEqual(cleanRelayAnswer({ phantom_encryption_public_key: "Abc123", nonce: "N1", data: "D1", extra: "dropped" }), { phantom_encryption_public_key: "Abc123", nonce: "N1", data: "D1" });
  assert.deepEqual(cleanRelayAnswer({ errorCode: "4001", errorMessage: "User rejected the request." }), { errorCode: "4001", errorMessage: "User rejected the request." });
  for (const bad of [null, "x", {}, { nonce: "N1" }, { nonce: "N1", data: "has spaces" }, { nonce: "N1", data: "<script>" }, { nonce: "N", data: "D".repeat(7000) }]) assert.equal(cleanRelayAnswer(bad), null, JSON.stringify(bad)?.slice(0, 40));
  // A slot is a plain record in the bot's key/value table, under its own prefix.
  const slot: RelaySlot = { telegramId: 5, expiresAt: NOW + 1000, answer: null };
  await tgSetState(db, relayKey("b".repeat(32)), slot, NOW);
  assert.deepEqual(await tgGetState<RelaySlot>(db, relayKey("b".repeat(32))), slot);
});

test("the relay, end to end: the wallet's answer is kept even if it arrives BEFORE the Mini App could claim the slot, and is read once, by one account", async () => {
  const { setDbForTests } = await import("@/lib/db/client");
  const saved = { ...process.env };
  Object.assign(process.env, ON);
  setDbForTests(db);
  try {
    const route = (await import("@/app/api/tg/relay/route")) as Record<"GET" | "POST" | "PUT", (req: Request) => Promise<Response>>;
    const auth = (telegramId: number) => ({ Authorization: `Bearer ${issueSession(telegramId, TOKEN, Date.now()).token}`, "Content-Type": "application/json" });
    const post = (id: string, who: number) => route.POST(new Request("https://launchonpanda.app/api/tg/relay", { method: "POST", headers: auth(who), body: JSON.stringify({ id }) }));
    const put = (id: string, answer: unknown) => route.PUT(new Request("https://launchonpanda.app/api/tg/relay", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, answer }) }));
    const get = async (id: string, who: number) => (await route.GET(new Request(`https://launchonpanda.app/api/tg/relay?id=${id}`, { headers: auth(who) }))).json() as Promise<{ pending?: boolean; answer?: Record<string, string> }>;
    const answer = { phantom_encryption_public_key: "WalletKey1", nonce: "Nonce1", data: "Data1" };
    const ana = 880001;
    const eve = 880002;

    // 1) The normal order: claimed, answered, collected.
    const a = "c".repeat(32);
    assert.equal((await post(a, ana)).status, 200);
    assert.equal((await post(a, ana)).status, 200, "saying it twice is fine");
    assert.equal((await post(a, eve)).status, 409, "another account can't take a slot that has an owner");
    assert.deepEqual(await get(a, ana), { pending: true });
    assert.equal((await put(a, answer)).status, 200);
    assert.equal((await put(a, answer)).status, 410, "filled once");
    assert.deepEqual(await get(a, eve), { pending: true }, "nothing for anyone else");
    assert.deepEqual(await get(a, ana), { answer });
    assert.deepEqual(await get(a, ana), { pending: true }, "read once");

    // 2) The phone froze the Mini App before it could claim the slot: the wallet's answer is still kept…
    const b = "d".repeat(32);
    assert.deepEqual(await get(b, ana), { pending: true }, "nothing there yet is 'keep waiting', not an error");
    assert.equal((await put(b, answer)).status, 200);
    // …and whoever comes back knowing the id (only the Mini App that made it does) collects it.
    assert.deepEqual(await get(b, ana), { answer });

    // 3) Claimed AFTER the answer arrived: the claim keeps the answer.
    const c = "e".repeat(32);
    assert.equal((await put(c, { errorCode: "4001", errorMessage: "User rejected the request." })).status, 200);
    assert.equal((await post(c, ana)).status, 200);
    assert.deepEqual(await get(c, eve), { pending: true });
    assert.deepEqual(await get(c, ana), { answer: { errorCode: "4001", errorMessage: "User rejected the request." } });

    // Junk is refused, and reading needs a session.
    assert.equal((await put("f".repeat(32), { data: "<script>" })).status, 400);
    assert.equal((await put("short", answer)).status, 400);
    assert.equal((await route.GET(new Request(`https://launchonpanda.app/api/tg/relay?id=${a}`))).status, 401);
  } finally {
    setDbForTests(null);
    for (const k of Object.keys(ON)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("waiting for a wallet never uses up the allowance of anything else: each kind of request has its own count", () => {
  const gate = readFileSync("src/lib/telegram/miniapp-route.ts", "utf8");
  assert.ok(gate.includes("rateLimited(`tg-app:${bucket}:${session.telegramId}`, perMinute, 60_000)"));
  const route = readFileSync("src/app/api/tg/relay/route.ts", "utf8");
  assert.ok(route.includes('appGate(req, 60, "relay-open")') && route.includes('appGate(req, 120, "relay-read")'));
});

test("the wallet link is opened INSIDE the tap, and a signature waits for the user's own tap on the sheet", () => {
  const adapter = readFileSync("src/lib/wallet/deeplink/adapter.ts", "utf8");
  const connect = adapter.slice(adapter.indexOf("  async connect(): Promise<void> {"), adapter.indexOf("  async disconnect()"));
  // Nothing is awaited before the link is opened: Telegram.WebApp.openLink only works inside a tap.
  assert.ok(connect.indexOf("b.openLink(url);") > 0 && !connect.slice(0, connect.indexOf("b.openLink(url);")).includes("await "));
  const request = adapter.slice(adapter.indexOf("  private async request<T>"), adapter.indexOf("  private openSlot"));
  // A transaction's signature waits for the user's own tap on the sheet ("sheet" is the default); only the sign-in,
  // started by a tap on "Connect and sign in", opens the wallet itself — and then before anything is awaited.
  assert.ok(request.includes('const open = o.open ?? "sheet";') && request.includes('opened: open !== "sheet"') && request.includes("await ui.ready;"));
  assert.ok(request.indexOf("b.openLink(url);") > 0 && !request.slice(0, request.indexOf("b.openLink(url);")).includes("await "));
  assert.equal(adapter.split('{ kind: "login", open, onRelay').length, 2);
  assert.equal((adapter.match(/onRelay: /g) ?? []).length, 1, "only signLogin passes options to a request: every other signature waits for the sheet's tap");
  assert.match(adapter, /export const RELAY_WAIT_MS = 2 \* 60_000;/);
  const shell = readFileSync("src/components/tg/TgShell.tsx", "utf8");
  assert.ok(shell.includes("tg.openLink(url, { try_instant_view: false })"), "Telegram's official method");
  assert.ok(shell.includes("openExternal(step.url); // inside the tap on the sheet's button"));
  assert.ok(shell.includes('sheet.phase === "timeout"') && shell.includes('t("tg.wallet.browser")'), "after two minutes: what happened and 'Open in browser'");
  // The page keeps trading on the same panel, and a computer gets no button that can't work.
  const coinScreen = readFileSync("src/components/tg/TgCoin.tsx", "utf8");
  const start = shell.slice(shell.indexOf("  function startLogin("), shell.indexOf("  const logout ="));
  assert.ok(start.includes("await adapter.connect(); // opens the wallet before anything is awaited") && start.indexOf("adapter.connect()") < start.indexOf("select(name);"));
  assert.ok(!start.slice(0, start.indexOf("adapter.restoreSaved()")).includes("await "), "the tap reaches the wallet with nothing awaited on the way");
  assert.ok(coinScreen.includes("authed && !!address && address === linked"), "trading needs the app's session and the linked wallet");
  assert.ok(coinScreen.includes("{!phone ? (") && coinScreen.includes('t("tg.wallet.desktop")'));
  assert.ok(coinScreen.includes("coin={drawOn ? coin : undefined}"), "Draw Your Trade is the website's own, on the same chart");
});

test("phone or computer, and the way back to a coin", async () => {
  const { coinOfStartParam, isPhonePlatform, webAddressOf } = await import("@/components/tg/TgShell");
  for (const p of ["android", "ios", "android_x"]) assert.equal(isPhonePlatform(p), true, p);
  for (const p of ["tdesktop", "macos", "weba", "webk", "web", "unigram", "unknown", "", undefined, null]) assert.equal(isPhonePlatform(p), false, String(p));
  assert.equal(coinOfStartParam(`c_${PANDA}`), PANDA);
  for (const bad of ["back", "c_", "c_../../admin", `x_${PANDA}`, undefined, null]) assert.equal(coinOfStartParam(bad), null, String(bad));
  assert.equal(webAddressOf(`/tg/coin/${PANDA}`), `/coin/${PANDA}?draw=1`, "the same coin, with Draw Your Trade open");
  assert.equal(webAddressOf("/tg/alerts"), "/");
});

test("the bot's 'Open PANDA app' button exists only with the flag on, and only in a private chat", () => {
  const off = testConfig();
  assert.ok(!startButtons(off, "en").some((b) => "web_app" in b));
  const on = testConfig({ miniAppUrl: "https://launchonpanda.app/tg" });
  assert.deepEqual(startButtons(on, "en")[0], { text: "🐼 Open PANDA app", web_app: { url: "https://launchonpanda.app/tg" } });
  assert.deepEqual(startButtons(on, "es")[0], { text: "🐼 Abrir la app de PANDA", web_app: { url: "https://launchonpanda.app/tg" } });
  assert.ok(!startButtons(on, "en", "supergroup").some((b) => "web_app" in b), "Telegram refuses a web_app button in a group");
  assert.equal(telegramConfig({}).miniAppUrl, null);
  assert.equal(telegramConfig(ON).miniAppUrl, "https://launchonpanda.app/tg");
  assert.equal(telegramConfig({ ...ON, FEATURE_TELEGRAM_MINIAPP: "false" }).miniAppUrl, null);
});

test("only the Mini App's pages may be framed by Telegram and load Telegram's script; the rest of the site is untouched", () => {
  const site = buildCsp({ nonce: "n" });
  assert.ok(site.includes("frame-ancestors 'none'") && !site.includes("telegram.org"));
  const app = buildCsp({ nonce: "n", telegram: true });
  assert.ok(app.includes("frame-ancestors https://web.telegram.org https://*.telegram.org") && !app.includes("frame-ancestors 'none'"));
  assert.match(app, /script-src 'self' 'nonce-n' 'strict-dynamic' https:\/\/telegram\.org/);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(app));
  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.ok(proxy.includes('const miniAppOn = process.env.FEATURE_TELEGRAM_BOT === "true" && process.env.FEATURE_TELEGRAM_MINIAPP === "true";') && proxy.includes("const telegram = isMiniAppPath(path) && miniAppOn;"));
  assert.ok(proxy.includes('if (!miniAppOn && (isMiniAppPath(path) || path === "/telegram/wallet" || path.startsWith("/telegram/wallet/"))) hidden = true;'), "flag off: the pages answer a real 404");
  const next = readFileSync("next.config.ts", "utf8");
  assert.ok(next.includes('if (!MINIAPP_ON) return [{ source: "/:path*", headers: securityHeaders }];'), "flag off: every page keeps X-Frame-Options: DENY");
});

test("nothing in the Mini App asks for, stores or sends a key or a seed phrase; trading is the website's own panel", () => {
  const files = ["src/components/tg/TgShell.tsx", "src/components/tg/TgCoin.tsx", "src/components/tg/TgScreens.tsx", "src/components/tg/TgWalletReturn.tsx", "src/lib/wallet/deeplink/adapter.ts", "src/lib/telegram/miniapp.ts"];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/Keypair\.fromSecretKey|mnemonic|privateKey|secretKey\s*:\s*string;\s*\/\/ user/i.test(src), f);
    assert.ok(!/type="password"|seed phrase"\s*\/>/i.test(src), f);
  }
  const coinScreen = readFileSync("src/components/tg/TgCoin.tsx", "utf8");
  assert.ok(coinScreen.includes("<TradingPanel coin={coin} />"), "the same panel as the website: same fees, recruiters, warnings and routes");
  assert.ok(coinScreen.includes("address === linked"), "only the wallet linked with /link trades here");
  assert.ok(coinScreen.includes('t("tg.wallet.browser")'), "'Open in browser' is always there");
});
