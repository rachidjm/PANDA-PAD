import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearPendingLaunch, notePendingLaunch, pendingLaunch, takePendingLaunch } from "./launch";

/** Creating a coin in the Mini App: the website's own form, and a launch is never left half-recorded. */

const disk = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => disk.get(k) ?? null,
  setItem: (k: string, v: string) => void disk.set(k, v),
  removeItem: (k: string) => void disk.delete(k),
};
beforeEach(() => disk.clear());

const MINT = "zefa42tKR24WwpYZJujta7CDkD43n47soQwCoJpanda";
const T0 = 1_800_000_000_000;
const answer = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;

test("the create screen is the website's own form: same code, same rules, same signatures", () => {
  const screen = readFileSync("src/components/tg/TgCreate.tsx", "utf8");
  assert.ok(screen.includes('dynamic(() => import("@/app/create/CreateClient")'), "the website's form itself, downloaded when the screen is opened");
  assert.ok(screen.includes("coinHref={(mint) => `/tg/coin/${mint}`}"), "the new coin opens inside the app");
  // Nothing about a launch is decided in the Mini App: no route, transaction or fee rule of its own.
  assert.doesNotMatch(screen, /api\/pump|upload-metadata|sendTransaction|shareBps|FeeDistribution/);
  assert.ok(screen.includes("useLinkedWallet()") && readFileSync("src/components/tg/TgConnect.tsx", "utf8").includes("ready: phone && authed && !!address && address === linked"), "signed in, with the wallet linked to this Telegram account connected");
  const page = readFileSync("src/app/tg/create/page.tsx", "utf8");
  assert.ok(page.includes("createMinFirstBuySol()"), "the same minimum first buy as the website");
  // The website's form is what it was: the three openings are optional and it is called there without them.
  const form = readFileSync("src/app/create/CreateClient.tsx", "utf8");
  assert.ok(form.includes("coinHref = (mint) => `/coin/${mint}`") && form.includes("onSigning?.(") && form.includes("onLaunched?.("));
  assert.ok(readFileSync("src/app/create/page.tsx", "utf8").includes("<CreateClient minFirstBuySol={createMinFirstBuySol()} />"));
  assert.ok(form.includes('accept="image/gif,image/png,image/jpeg,image/webp"'), "a picture from the phone: its gallery or its camera");
  assert.ok(readFileSync("src/components/tg/TgShell.tsx", "utf8").includes('{ href: "/tg/create", label: "tg.nav.create"'), "Create is in the app's bar");
});

test("a coin being created is written down as its public address only, for minutes", () => {
  notePendingLaunch(MINT, T0);
  assert.deepEqual(JSON.parse(disk.get("panda.tg.launch")!), { mint: MINT, at: T0 });
  assert.deepEqual(pendingLaunch(T0 + 60_000), { mint: MINT, at: T0 });
  assert.equal(pendingLaunch(T0 + 31 * 60_000), null);
  assert.equal(disk.size, 0, "an old one is removed");
  notePendingLaunch("not an address", T0);
  assert.equal(disk.size, 0);
  notePendingLaunch(MINT, T0);
  clearPendingLaunch(); // the form heard back itself: nothing is pending
  assert.equal(pendingLaunch(T0), null);
});

test("Telegram restarted the app during a launch: if the coin exists its records are completed and its page opens", async () => {
  notePendingLaunch(MINT, T0);
  const asked: string[] = [];
  const posted: [string, unknown][] = [];
  const api = async (path: string) => {
    asked.push(path);
    return answer({ signature: "5igNaTuRe" });
  };
  const post = async (path: string, body: unknown) => void posted.push([path, body]);
  assert.equal(await takePendingLaunch(api, T0 + 90_000, post), MINT);
  assert.deepEqual(asked, [`/api/tg/launch?mint=${MINT}`]);
  // The same records the form writes when it hears back itself — through the website's own routes, which check the chain.
  assert.deepEqual(posted, [
    ["/api/launch/record", { mint: MINT, signature: "5igNaTuRe" }],
    ["/api/pump/register-fee-distribution", { mint: MINT }],
  ]);
  assert.equal(disk.size, 0);
  assert.equal(await takePendingLaunch(api, T0 + 95_000, post), null, "once");
  assert.equal(asked.length, 1);
});

test("a launch that was cancelled in the wallet records nothing, and a failed check is tried again", async () => {
  const posted: unknown[] = [];
  const post = async (path: string) => void posted.push(path);
  notePendingLaunch(MINT, T0);
  // The server can't say right now: asked again on the next start.
  assert.equal(await takePendingLaunch(async () => answer({ error: "unavailable" }, false), T0 + 60_000, post), null);
  assert.ok(pendingLaunch(T0 + 60_000));
  // Not on the chain yet (a slow confirmation): kept for a few minutes…
  assert.equal(await takePendingLaunch(async () => answer({ signature: null }), T0 + 2 * 60_000, post), null);
  assert.ok(pendingLaunch(T0 + 2 * 60_000));
  // …then forgotten: it was cancelled.
  assert.equal(await takePendingLaunch(async () => answer({ signature: null }), T0 + 6 * 60_000, post), null);
  assert.equal(pendingLaunch(T0 + 6 * 60_000), null);
  assert.deepEqual(posted, []);
  // Nothing pending: nothing is asked.
  let calls = 0;
  await takePendingLaunch(async () => (calls++, answer({ signature: "x" })), T0, post);
  assert.equal(calls, 0);
});

test("the route that finds a coin's creating transaction needs the Telegram session and only reads the chain", () => {
  const route = readFileSync("src/app/api/tg/launch/route.ts", "utf8");
  assert.ok(route.includes('await appGate(req, 20, "launch")') && route.includes("walletKey("));
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)|getDb|pgRecord/);
});
