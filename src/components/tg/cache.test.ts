import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cached, cacheFailed, clearTgCache, FIRST_LISTS, FRESH_MS, isFresh, isListPath, knownCoin, putCached, refresh } from "./cache";

/** What makes the Mini App quick: nothing is downloaded twice, and its first screen doesn't wait for the wallet code. */

beforeEach(() => clearTgCache());

const answer = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;

test("one download per address, however many parts of a screen ask — and what was seen is there at once", async () => {
  let calls = 0;
  const api = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return answer({ items: [{ mint: "M1", ticker: "ONE", name: "One", image: null, priceUsd: 1, marketCap: 10, change24h: 2 }] });
  };
  await Promise.all([refresh(api, "/api/tg/watchlist"), refresh(api, "/api/tg/watchlist"), refresh(api, "/api/tg/watchlist")]);
  assert.equal(calls, 1);
  assert.equal(cached<{ items: unknown[] }>("/api/tg/watchlist")?.items.length, 1);
  assert.equal(isFresh("/api/tg/watchlist"), true, "a screen opened again within seconds asks for nothing");
  assert.equal(isFresh("/api/tg/watchlist", Date.now() + FRESH_MS + 1), false, "later it is shown at once and brought up to date behind");
  assert.equal(isFresh("/api/tg/alerts"), false);
});

test("a failed download leaves what was already there, and says so only when there is nothing to show", async () => {
  const down = async () => answer({ error: "unavailable" }, false);
  await refresh(down, "/api/tg/alerts");
  assert.equal(cacheFailed("/api/tg/alerts"), true);
  putCached("/api/tg/alerts", { alerts: [] });
  await refresh(async () => Promise.reject(new Error("offline")), "/api/tg/alerts");
  assert.equal(cacheFailed("/api/tg/alerts"), false, "the list seen before stays on screen");
  assert.deepEqual(cached("/api/tg/alerts"), { alerts: [] });
});

test("a coin's page starts with what a list already showed of it", () => {
  assert.equal(knownCoin("M2"), null);
  putCached("/api/tg/coins?tab=trending", { coins: [{ mint: "M2", ticker: "TWO", name: "Two", image: null, priceUsd: 2, marketCap: 20, change24h: -1 }] });
  assert.equal(knownCoin("M2")?.ticker, "TWO");
  assert.equal(knownCoin("nope"), null);
});

test("the lists are the screens that open before the wallet code, and their data is asked for first", () => {
  for (const p of ["/tg", "/tg/watchlist", "/tg/alerts"]) assert.equal(isListPath(p), true, p);
  for (const p of ["/tg/coin/abc", "/tg/create", "/", null]) assert.equal(isListPath(p), false, String(p));
  assert.deepEqual(FIRST_LISTS, ["/api/tg/coins?tab=trending", "/api/tg/coins?tab=new", "/api/tg/watchlist", "/api/tg/alerts"]);
});

test("the first screen never brings the wallet libraries, and the website's frame never reaches the Mini App", () => {
  const heavy = /from "@solana\/(web3\.js|wallet-adapter-react|wallet-adapter-phantom)"|from "@\/lib\/wallet\/deeplink\/adapter"|from "@\/components\/coin\//;
  // What the shell loads before anything is on screen: none of it may import the wallet libraries (types don't count).
  for (const f of ["TgShell.tsx", "TgScreens.tsx", "TgSkeleton.tsx", "session.ts", "cache.ts", "useTgData.ts", "bits.tsx"]) {
    const src = readFileSync(`src/components/tg/${f}`, "utf8").replace(/^import type .*$/gm, "");
    assert.doesNotMatch(src, heavy, f);
  }
  for (const f of ["src/lib/wallet/deeplink/bridge.ts", "src/lib/auth/session-delegate.ts"]) assert.doesNotMatch(readFileSync(f, "utf8").replace(/^import type .*$/gm, ""), /from "@solana|\.\/adapter"/, f);
  const shell = readFileSync("src/components/tg/TgShell.tsx", "utf8");
  assert.ok(shell.includes('const loadWalletRoot = () => import("./TgWalletRoot");') && shell.includes("lazy(loadWalletRoot)"), "the wallet code arrives after the first screen");
  const coin = readFileSync("src/components/tg/TgCoin.tsx", "utf8");
  assert.ok(coin.includes('dynamic(() => import("@/components/coin/PriceChart")') && coin.includes('dynamic(() => import("@/components/coin/TradingPanel")'), "the chart and the trading panel are downloaded when they are shown");
  // The website's frame is one separate module, chosen by the address; the root layout imports neither frame's contents.
  const frame = readFileSync("src/components/AppFrame.tsx", "utf8");
  assert.ok(frame.includes('dynamic(() => import("./SiteFrame"))') && frame.includes("isTgPath(usePathname())"));
  assert.doesNotMatch(readFileSync("src/app/layout.tsx", "utf8"), /Navbar|WalletProvider|AIAssistant/);
  // Tapping a screen shows it at once; a coin shows its skeleton at once.
  assert.ok(readFileSync("src/app/tg/loading.tsx", "utf8").includes("<TgInstant />"));
  assert.ok(readFileSync("src/app/tg/coin/[mint]/loading.tsx", "utf8").includes("<CoinSkeleton />"));
});
