import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { telegramLinkCodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createLinkCode, hashLinkCode, LINK_TTL_MS } from "./link";
import { BACK_TO_TELEGRAM, browseUrl, isPhone, LINK_WALLET_APPS, linkCodeState, linkPageAddress } from "./link-page";
import { newUserId } from "./testing";

/**
 * The wallet-linking page on a phone: Telegram opens it in a browser with no wallet, so it opens ITSELF inside the
 * wallet app; there, one button connects and signs; afterwards, one button goes back to Telegram.
 */

const ORIGIN = "https://launchonpanda.app";
const CODE = "AbCdEfGhIjKlMnOpQrStUvWx";

test("'Open in Phantom' / 'Open in Solflare': the wallets' official browse links, to this same page with its one-time code", () => {
  const page = linkPageAddress(`${ORIGIN}/`, CODE);
  assert.equal(page, `${ORIGIN}/telegram/link?code=${CODE}`);
  assert.deepEqual(LINK_WALLET_APPS.map((a) => a.id), ["phantom", "solflare"]);

  const phantom = browseUrl("phantom", page, ORIGIN);
  assert.equal(phantom, `https://phantom.app/ul/browse/${encodeURIComponent(page)}?ref=${encodeURIComponent(ORIGIN)}`);
  const solflare = browseUrl("solflare", page, ORIGIN);
  assert.equal(solflare, `https://solflare.com/ul/v1/browse/${encodeURIComponent(page)}?ref=${encodeURIComponent(ORIGIN)}`);
  for (const link of [phantom, solflare]) {
    const u = new URL(link);
    // The page's address is ONE path segment (fully encoded): the wallet app opens exactly it, code included.
    const target = decodeURIComponent(u.pathname.split("/").pop()!);
    assert.equal(target, page);
    assert.equal(new URL(target).searchParams.get("code"), CODE);
    assert.equal(u.searchParams.get("ref"), ORIGIN);
    assert.ok(!u.pathname.includes("?") && !u.pathname.includes("&"));
  }
});

test("a phone is told from a computer, and going back only brings Telegram to the front", () => {
  for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"]) assert.equal(isPhone(ua), true, ua);
  for (const ua of ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", ""]) assert.equal(isPhone(ua), false, ua);
  assert.equal(BACK_TO_TELEGRAM, "tg://resolve");
});

test("a link that was used or is too old is said to be over BEFORE anyone opens their wallet", () => {
  const now = 1_800_000_000_000;
  assert.equal(linkCodeState({ usedAt: null, expiresAt: now + 1 }, now), "ok");
  assert.equal(linkCodeState({ usedAt: null, expiresAt: now }, now), "expired");
  assert.equal(linkCodeState({ usedAt: now - 5, expiresAt: now + 60_000 }, now), "expired");
  assert.equal(linkCodeState(null, now), "invalid");
});

let db: Db;
before(async () => {
  db = await newTestDb();
});

test("the page asks the server about its code: usable, over, or not a code — and learns nothing else", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { FEATURE_TELEGRAM_BOT: "true" });
  setDbForTests(db);
  try {
    const { GET } = (await import("@/app/api/telegram/link/route")) as { GET: (req: Request) => Promise<Response> };
    const ask = async (code: string) => (await GET(new Request(`${ORIGIN}/api/telegram/link?code=${encodeURIComponent(code)}`))).json() as Promise<Record<string, unknown>>;
    const who = newUserId() + 300_000;
    const fresh = await createLinkCode(db, who, Date.now());
    assert.deepEqual(await ask(fresh.code), { state: "ok" }, "nothing but the state: not whose code it is");
    assert.deepEqual(await ask("x".repeat(24)), { state: "invalid" });
    assert.deepEqual(await ask("short"), { state: "invalid" });
    assert.deepEqual(await ask(""), { state: "invalid" });
    // Used…
    await db.update(telegramLinkCodes).set({ usedAt: Date.now() }).where(eq(telegramLinkCodes.codeHash, hashLinkCode(fresh.code)));
    assert.deepEqual(await ask(fresh.code), { state: "expired" });
    // …or simply older than its ten minutes.
    const old = await createLinkCode(db, who, Date.now() - LINK_TTL_MS - 1000);
    assert.deepEqual(await ask(old.code), { state: "expired" });
    // Asking changes nothing: the fresh code of another request is still usable afterwards.
    const again = await createLinkCode(db, who, Date.now());
    await ask(again.code);
    assert.deepEqual(await ask(again.code), { state: "ok" });
    process.env.FEATURE_TELEGRAM_BOT = "false";
    assert.equal((await GET(new Request(`${ORIGIN}/api/telegram/link?code=${again.code}`))).status, 404);
  } finally {
    setDbForTests(null);
    delete process.env.FEATURE_TELEGRAM_BOT;
    Object.assign(process.env, saved);
  }
});

test("the page: big buttons in the middle, one step to connect and sign, a clear end — and no 'button at the top'", () => {
  const page = readFileSync("src/components/telegram/TelegramLinkClient.tsx", "utf8");
  const texts = readFileSync("src/lib/i18n/translations.ts", "utf8");
  assert.doesNotMatch(texts, /button at the top|botón de arriba/);
  assert.doesNotMatch(page, /"tg\.link\.connect"/);
  // A wallet available to the page: ONE button that connects and then asks for the signature.
  const flow = page.slice(page.indexOf("  async function connectAndSign("), page.indexOf("  const big ="));
  assert.ok(flow.indexOf("await adapter.connect();") > 0 && flow.indexOf("await adapter.connect();") < flow.indexOf("await adapter.signMessage("), "connect, then sign, from the same tap");
  assert.ok(page.includes("w.readyState === WalletReadyState.Installed") && page.includes('t("tg.link.connectSign")'));
  // A phone's browser without one: this same page inside the wallet app.
  assert.ok(page.includes("href={browseUrl(a.id, page, window.location.origin)}") && page.includes('t("tg.link.openInWallet", { wallet: a.label })'));
  assert.ok(page.includes("linkPageAddress(window.location.origin, code)"));
  // Linked: the address, shortened, and a button that only goes back to Telegram.
  const done = page.slice(page.indexOf('if (phase === "done" && linked)'), page.indexOf("// ── a link that is over"));
  assert.ok(done.includes('t("tg.link.doneTitle")') && done.includes("truncateAddress(linked)") && done.includes("<a href={BACK_TO_TELEGRAM}"));
  assert.doesNotMatch(done, /startapp|t\.me/);
  // Over: said clearly, with where a new one comes from.
  assert.ok(page.includes('t("tg.link.newLink")') && page.includes('if (c === "code_used_or_expired") setCodeState("expired");'));
  // The safety notice stays — small, under the buttons, not in red.
  const notice = page.slice(page.lastIndexOf("<p", page.indexOf('{t("tg.link.never")}')), page.indexOf('{t("tg.link.never")}'));
  assert.ok(/text-\[11px\]/.test(notice) && /text-panda-grey/.test(notice) && !/clay-red/.test(notice));
  assert.ok(page.indexOf('{t("tg.link.never")}') > page.indexOf('t("tg.link.connectSign")'));
  for (const key of ["tg.link.openIn", "tg.link.openInWallet", "tg.link.connectSign", "tg.link.doneTitle", "tg.link.doneBody", "tg.link.expiredTitle", "tg.link.expiredBody", "tg.link.newLink", "tg.link.noWalletDesktop"]) {
    const line = texts.split("\n").find((l) => l.includes(`"${key}":`)) ?? "";
    assert.ok(/en: ".+", es: ".+"/.test(line), `${key} in both languages`);
  }
  // The Mini App that stayed open notices the link by itself when it is back on screen.
  const shell = readFileSync("src/components/tg/TgShell.tsx", "utf8");
  assert.ok(shell.includes('document.addEventListener("visibilitychange", look);') && shell.includes("if (await refreshWallet()) await startLogin();"));
});
