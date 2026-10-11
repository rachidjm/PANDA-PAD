/**
 * updates-shot — takes the screenshots of the Updates page (/updates) with a real browser (Chrome, without a window).
 *
 *   npm run shot -- <shots.json> [--base https://launchonpanda.app] [--out public/updates] [--only name1,name2]
 *
 * It opens each page in a brand-new, EMPTY browser profile — no wallet, no session, nobody's data — sets the site's
 * language, optionally runs a few steps (a click, typing in a box), and saves the chosen area as a light WebP: two
 * files when the screen's text changes with the language ("name.en.webp", "name.es.webp"), one otherwise ("name.webp").
 *
 * What must NEVER be in a picture is not something a script can promise: full wallet addresses, real balances, the admin
 * area, settings or personal data. The empty profile keeps a wallet out by construction; every picture is still looked
 * at by whoever runs this before it is sent for approval (docs/TELEGRAM.md, section 13).
 *
 * shots.json: { "shots": [ {
 *   "name": "chart-zoom",              file name (a-z, 0-9, dashes)
 *   "url": "/coin/<mint>",             path on the site
 *   "langs": ["en", "es"],             omit for a picture with no text in it
 *   "width": 900, "height": 1100,      the window (default 900 x 1100); "mobile": true for a phone (390 wide)
 *   "wait": 2500,                      ms to wait after loading (default 2500)
 *   "steps": "…JavaScript…",           optional, run in the page before measuring (may be async, may use `sleep(ms)`)
 *   "selector": "css",                 the area: an element…
 *   "clip": { "x":0,"y":0,"w":0,"h":0 }   …or a box of the page, in CSS pixels
 *   "pad": 12,                         extra pixels around the element (default 12)
 *   "maxHeight": 900,                  cuts a very tall element (default 900)
 *   "hide": ["css", …]                 elements to hide first (a sticky bar over the area, say)
 *   "storage": { "key": "value" }      values put in the page's localStorage before its own code runs
 *   "mock": { "/api/x": {…} }          sample answers for the page's own data requests whose address contains the key
 *                                      (first match wins; "{lang}" in a text becomes the shot's language). For screens
 *                                      that need a session — the Telegram Mini App — so no real account is ever used.
 * } ], "hide": ["css", …] }            …and elements to hide in every shot
 *
 * `steps` may also choose the area itself, by setting `window.__clip = { x, y, w, h }` (page coordinates).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import WebSocket from "ws";

type Shot = {
  name: string;
  url: string;
  langs?: ("en" | "es")[];
  width?: number;
  height?: number;
  mobile?: boolean;
  wait?: number;
  steps?: string;
  selector?: string;
  clip?: { x: number; y: number; w: number; h: number };
  pad?: number;
  maxHeight?: number;
  hide?: string[];
  mock?: Record<string, unknown>;
  storage?: Record<string, string>;
};

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The smallest client of Chrome's own remote-control protocol: send a command, wait for its answer. */
class Page {
  private id = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** Answers the page's paused data requests (Shot.mock); null lets none be paused. */
  onPaused: ((requestId: string, url: string) => void) | null = null;
  constructor(private ws: WebSocket) {
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as { id?: number; method?: string; params?: { requestId: string; request: { url: string } }; result?: unknown; error?: { message: string } };
      if (m.id === undefined) {
        if (m.method === "Fetch.requestPaused" && m.params) this.onPaused?.(m.params.requestId, m.params.request.url);
        return;
      }
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message));
      else w.resolve(m.result);
    });
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

async function launch(): Promise<{ chrome: ChildProcess; profile: string; port: number }> {
  const exe = CHROME_PATHS.find((p) => existsSync(p));
  if (!exe) throw new Error("Chrome wasn't found. Set CHROME_PATH to its executable.");
  // A new, empty profile every time: no wallet extension, no session, no history.
  const profile = mkdtempSync(path.join(tmpdir(), "panda-shot-"));
  const chrome = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio", "--window-size=1200,1200", "about:blank"], { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error("Chrome didn't start.");
  return { chrome, profile, port: Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]) };
}

async function openPage(port: number): Promise<Page> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = (await res.json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new Page(ws);
}

async function take(page: Page, base: string, shot: Shot, lang: "en" | "es" | null, outDir: string, hideAlways: string[]): Promise<string> {
  const mobile = !!shot.mobile;
  const width = shot.width ?? (mobile ? 390 : 900);
  const height = shot.height ?? (mobile ? 844 : 1100);
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  // Before any of the site's own code runs: its language, and the first-visit guide already seen.
  const boot = `try { localStorage.setItem("panda-lang", ${JSON.stringify(lang ?? "en")}); localStorage.setItem("panda.draw.tutorial.seen", "1"); for (const [k, v] of ${JSON.stringify(Object.entries(shot.storage ?? {}))}) localStorage.setItem(k, v); } catch {}`;
  const { identifier } = await page.send<{ identifier: string }>("Page.addScriptToEvaluateOnNewDocument", { source: boot });
  const mocks = Object.entries(shot.mock ?? {});
  page.onPaused = (requestId, url) => {
    const hit = mocks.find(([key]) => url.includes(key));
    if (!hit) return void page.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
    const body = JSON.stringify(hit[1]).replaceAll("{lang}", lang ?? "en");
    page.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(body).toString("base64") }).catch(() => undefined);
  };
  if (mocks.length) await page.send("Fetch.enable", { patterns: mocks.map(([key]) => ({ urlPattern: `*${key}*` })) });
  else await page.send("Fetch.disable").catch(() => undefined);
  // From a blank page: an address that only differs from the last one after "#" would not load again.
  await page.send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await page.send("Page.navigate", { url: new URL(shot.url, base).toString() });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if ((await page.evaluate<string>("document.readyState").catch(() => "")) === "complete") break;
  }
  await sleep(shot.wait ?? 2500);
  await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  if (shot.steps) await page.evaluate(`(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${shot.steps} })()`);
  for (const css of [...hideAlways, ...(shot.hide ?? [])]) await page.evaluate(`document.querySelectorAll(${JSON.stringify(css)}).forEach((e) => (e.style.visibility = "hidden"))`);

  const chosen = shot.clip ?? (await page.evaluate<Shot["clip"] | null>("window.__clip ?? null"));
  let clip = chosen ? { x: chosen.x, y: chosen.y, width: chosen.w, height: chosen.h } : null;
  if (!clip) {
    if (!shot.selector) throw new Error(`${shot.name}: give a "selector" or a "clip".`);
    const pad = shot.pad ?? 12;
    const box = await page.evaluate<{ x: number; y: number; w: number; h: number } | null>(`(async () => {
      const el = document.querySelector(${JSON.stringify(shot.selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 900));
      const r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    })()`);
    if (!box || box.w < 4 || box.h < 4) throw new Error(`${shot.name}: nothing matches ${shot.selector} (or it has no size).`);
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    clip = { x, y, width: Math.min(width - x, box.w + pad * 2), height: Math.min(shot.maxHeight ?? 900, box.h + pad * 2) };
  }
  const { data } = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
  const file = path.join(outDir, `${shot.name}${lang ? `.${lang}` : ""}.webp`);
  // Light: at most 1400 px wide (sharp on a phone's screen at twice its size), WebP.
  await sharp(Buffer.from(data, "base64")).resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toFile(file);
  return file;
}

async function main() {
  const specFile = process.argv[2];
  if (!specFile || specFile.startsWith("--")) throw new Error("Usage: npm run shot -- <shots.json> [--base <site>] [--out <folder>] [--only a,b]");
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as { shots?: Shot[]; hide?: string[] };
  const only = arg("only")?.split(",");
  const shots = (spec.shots ?? []).filter((s) => !only || only.includes(s.name));
  if (shots.length === 0) throw new Error("No shots to take.");
  for (const s of shots) if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(s.name)) throw new Error(`"${s.name}": a name is lower-case letters, digits and dashes.`);
  const base = (arg("base") || "https://launchonpanda.app").replace(/\/+$/, "");
  const outDir = arg("out") || "public/updates";
  mkdirSync(outDir, { recursive: true });

  const { chrome, profile, port } = await launch();
  let failed = 0;
  try {
    const page = await openPage(port);
    await page.send("Page.enable");
    for (const shot of shots) {
      for (const lang of shot.langs?.length ? shot.langs : [null]) {
        try {
          const file = await take(page, base, shot, lang, outDir, spec.hide ?? []);
          console.log(`ok   ${file.replace(/\\/g, "/")}  ${(statSync(file).size / 1024).toFixed(0)} KB`);
        } catch (err) {
          failed++;
          console.log(`FAIL ${shot.name}${lang ? `.${lang}` : ""}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } finally {
    chrome.kill();
    await sleep(600);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // The browser can keep a file for a moment longer; the system's temp folder is cleaned on its own.
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
