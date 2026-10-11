/**
 * tg-perf — how long the Telegram Mini App takes to open and to change screen, on a phone with a slow connection.
 *
 *   npx tsx scripts/tg-perf.ts [--base http://localhost:3012] [--runs 3] [--mint <coin address>]
 *
 * It drives a real Chrome (no window, empty profile) as a phone: 390 x 844, a processor four times slower and
 * "Slow 4G" (1.6 Mbit/s down, 150 ms per round trip). The page is the real one, served by a production build; the Mini
 * App's own data routes (/api/tg/*) are answered here with sample data after a fixed delay, so no database, Telegram
 * account or wallet is involved and two runs can be compared. Times are from the tap (or the address being opened) to
 * the moment the screen shows its content.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const CHROME_PATHS = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter((p): p is string => !!p);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE = arg("base") ?? "http://localhost:3012";
const RUNS = Number(arg("runs") ?? 3);
const MINT = arg("mint") ?? "zefa42tKR24WwpYZJujta7CDkD43n47soQwCoJpanda";
const API_DELAY_MS = 350; // a data route's answer on that connection: the round trip plus the server's own time

type Event = { method?: string; params?: Record<string, unknown>; id?: number; result?: unknown; error?: { message: string } };

class Page {
  private id = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, (params: Record<string, unknown>) => void>();
  constructor(private ws: WebSocket) {
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as Event;
      if (m.id === undefined) return void (m.method && this.handlers.get(m.method)?.(m.params ?? {}));
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message));
      else w.resolve(m.result);
    });
  }
  on(method: string, handler: (params: Record<string, unknown>) => void) {
    this.handlers.set(method, handler);
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  /** Milliseconds until the page says yes (asked every 25 ms). */
  async until(condition: string, timeoutMs = 60_000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.evaluate<boolean>(`(() => { try { return !!(${condition}); } catch { return false; } })()`).catch(() => false)) return Date.now() - start;
      await sleep(25);
    }
    return NaN;
  }
}

const coin = (mint: string, ticker: string, name: string, priceUsd: number, marketCap: number, change24h: number) => ({ mint, ticker, name, image: null, priceUsd, marketCap, change24h, volume24h: 1000 });
const COINS = [coin(MINT, "PANDA", "Panda", 0.0012, 1_200_000, 4.2), ...Array.from({ length: 19 }, (_, i) => coin(`So1111111111111111111111111111111111111${String(i + 10)}2`, `COIN${i}`, `Sample coin ${i}`, 0.001 * (i + 1), 50_000 * (i + 1), i - 9))];
const SAMPLE: [RegExp, unknown][] = [
  [/\/api\/tg\/session/, { token: "sample", expiresAt: Date.now() + 3_600_000, lang: "en", firstName: "Sample", wallet: null }],
  [/\/api\/tg\/coins\?q=/, { coins: COINS.slice(0, 3) }],
  [/\/api\/tg\/search/, { groups: COINS.slice(0, 3).map((c) => ({ ...c, copies: 0, verified: false })) }],
  [/\/api\/tg\/coins/, { coins: COINS }],
  [/\/api\/tg\/watchlist/, { items: COINS.slice(0, 4) }],
  [/\/api\/tg\/alerts/, { alerts: [{ id: "a1", mint: MINT, ticker: "PANDA", metric: "price", direction: "above", value: 0.002 }] }],
  [/\/api\/tg\//, { ok: true }],
];

const text = (re: string) => `new RegExp(${JSON.stringify(re)}).test(document.body.innerText)`;
const click = (finder: string) => `(() => { const el = ${finder}; if (!el) throw new Error("not found"); el.click(); })()`;
const nav = (href: string) => click(`document.querySelector('nav a[href="${href}"]')`);
const rows = `document.querySelectorAll('a[href^="/tg/coin/"]').length`;

async function run(port: number): Promise<Record<string, number>> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = (await res.json()) as { webSocketDebuggerUrl: string; id: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const page = new Page(ws);
  let scriptBytes = 0;
  let totalBytes = 0;
  const kinds = new Map<string, string>();
  page.on("Network.responseReceived", (p) => void kinds.set(String(p.requestId), String(p.type)));
  page.on("Network.loadingFinished", (p) => {
    const n = Number(p.encodedDataLength) || 0;
    totalBytes += n;
    if (kinds.get(String(p.requestId)) === "Script") scriptBytes += n;
  });
  page.on("Fetch.requestPaused", (p) => {
    const url = String((p.request as { url: string }).url);
    const body = SAMPLE.find(([re]) => re.test(url))?.[1] ?? {};
    setTimeout(() => {
      page.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => undefined);
    }, API_DELAY_MS);
  });
  await page.send("Network.enable");
  await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/tg/*" }] });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await page.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });

  const out: Record<string, number> = {};
  const initData = encodeURIComponent(`user=${encodeURIComponent(JSON.stringify({ id: 42, first_name: "Sample", language_code: "en" }))}&auth_date=1790000000&hash=${"0".repeat(64)}`);
  await page.send("Page.navigate", { url: `${BASE}/tg#tgWebAppData=${initData}&tgWebAppVersion=8.0&tgWebAppPlatform=ios` });
  out["open: first screen (sign-in)"] = await page.until(text("Just looking"));
  await page.evaluate(click(`[...document.querySelectorAll("button")].find((b) => /Just looking/.test(b.textContent))`));
  out["explore: list on screen"] = await page.until(`${rows} > 3`);
  await sleep(1500);
  out["open: JavaScript downloaded (KB)"] = Math.round(scriptBytes / 1024);
  out["open: everything downloaded (KB)"] = Math.round(totalBytes / 1024);

  await page.evaluate(nav("/tg/watchlist"));
  out["explore -> watchlist"] = await page.until(`location.pathname === "/tg/watchlist" && ${rows} > 0`);
  await sleep(600);
  await page.evaluate(nav("/tg/alerts"));
  out["watchlist -> alerts"] = await page.until(`location.pathname === "/tg/alerts" && ${text("above")}`);
  await sleep(600);
  await page.evaluate(nav("/tg"));
  out["alerts -> explore"] = await page.until(`location.pathname === "/tg" && ${rows} > 3`);
  await sleep(600);
  await page.evaluate(click(`document.querySelector('a[href="/tg/coin/${MINT}"]')`));
  const tapped = Date.now();
  out["explore -> coin: something on screen"] = await page.until(`location.pathname.startsWith("/tg/coin/") && document.querySelector("h1")`);
  out["explore -> coin: chart drawn"] = (await page.until(`location.pathname.startsWith("/tg/coin/") && document.querySelector("[data-tutorial=chart] svg path, svg path[stroke]")`)) + 0 * tapped;
  await sleep(600);
  await page.evaluate(nav("/tg"));
  out["coin -> explore"] = await page.until(`location.pathname === "/tg" && ${rows} > 3`);
  await sleep(600);
  await page.evaluate(nav("/tg/watchlist"));
  out["explore -> watchlist (again)"] = await page.until(`location.pathname === "/tg/watchlist" && ${rows} > 0`);
  await sleep(1000);
  out["session: JavaScript downloaded (KB)"] = Math.round(scriptBytes / 1024);
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => undefined);
  return out;
}

async function main() {
  const exe = CHROME_PATHS.find((p) => existsSync(p));
  if (!exe) throw new Error("Chrome wasn't found. Set CHROME_PATH to its executable.");
  const results: Record<string, number>[] = [];
  for (let i = 0; i < RUNS; i++) {
    // A new, empty profile for every run: nothing cached, as on a first opening.
    const profile = mkdtempSync(path.join(tmpdir(), "panda-perf-"));
    const chrome: ChildProcess = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "--mute-audio", "about:blank"], { stdio: "ignore" });
    try {
      const portFile = path.join(profile, "DevToolsActivePort");
      for (let k = 0; k < 100 && !existsSync(portFile); k++) await sleep(100);
      results.push(await run(Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0])));
    } finally {
      chrome.kill();
      await sleep(500);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    }
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`\nMini App on a phone, Slow 4G, 4x slower processor - median of ${RUNS} runs (ms unless it says KB)\n`);
  for (const key of Object.keys(results[0])) console.log(`${key.padEnd(42)} ${String(median(results.map((r) => r[key]))).padStart(7)}   [${results.map((r) => r[key]).join(", ")}]`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
