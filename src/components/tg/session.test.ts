import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { appSession, endWalletTrip, installSessionFetch, inWalletTrip, startWalletTrip, takeTicket, wantsSession, type AppSession } from "./session";

/** The Mini App's session on the phone: in memory only, kept across a wallet trip, gone when it is closed. */

const disk = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => disk.get(k) ?? null,
  setItem: (k: string, v: string) => void disk.set(k, v),
  removeItem: (k: string) => void disk.delete(k),
};

const ORIGIN = "https://launchonpanda.app";
const session = (over: Partial<AppSession> = {}): AppSession => ({ token: "tgw1.token", jti: "11111111-2222-3333-4444-555555555555", resume: "ticket-ticket-ticket-ticket", wallet: "Wa11et", expiresAt: Date.now() + 3_600_000, ...over });

beforeEach(() => {
  disk.clear();
  appSession.set(null);
  appSession.setInitData("");
  endWalletTrip();
});

test("the session lives in memory: nothing about it is written to the phone, and closing it leaves nothing behind", () => {
  appSession.setInitData("query_id=1&hash=abc");
  appSession.set(session());
  assert.equal(appSession.get()?.wallet, "Wa11et");
  assert.deepEqual(appSession.headers(), { "x-panda-app-session": "tgw1.token", "x-tg-init-data": "query_id=1&hash=abc" });
  assert.equal(disk.size, 0, "signed in, and the phone's storage is still empty");

  appSession.set(null); // what closing does
  assert.equal(appSession.get(), null);
  assert.deepEqual(appSession.headers(), {});
  assert.equal(disk.size, 0);
});

test("an expired session is no session, and without Telegram's data nothing is sent", () => {
  appSession.setInitData("x=1");
  appSession.set(session({ expiresAt: Date.now() - 1 }));
  assert.equal(appSession.get(), null);
  assert.deepEqual(appSession.headers(), {});
  appSession.setInitData("");
  appSession.set(session());
  assert.deepEqual(appSession.headers(), {});
});

test("a trip to the wallet keeps the session, and leaves a one-time ticket only for as long as it lasts", () => {
  appSession.set(session());
  assert.equal(inWalletTrip(), false);
  startWalletTrip();
  assert.equal(inWalletTrip(), true, "leaving for the wallet is not leaving the app");
  assert.ok(appSession.get(), "the session is still in memory");
  const written = JSON.parse(disk.get("panda.tg.ticket")!);
  assert.deepEqual(Object.keys(written).sort(), ["at", "jti", "resume"], "the ticket is not the session: no token in it");
  assert.ok(![...disk.values()].some((v) => v.includes("tgw1.token")));

  // Back, with the app as it was: the ticket is removed.
  endWalletTrip();
  assert.equal(inWalletTrip(), false);
  assert.equal(disk.size, 0);

  // Back, but Telegram restarted the app (memory empty): the ticket is read once, then it is gone.
  startWalletTrip();
  appSession.set(null);
  assert.deepEqual(takeTicket(), { jti: session().jti, resume: session().resume });
  assert.equal(takeTicket(), null);
  assert.equal(disk.size, 0);
});

test("a ticket is useless after a few minutes, a trip ends by itself, and without a session there is no ticket", () => {
  const t0 = Date.now();
  appSession.set(session());
  startWalletTrip(t0);
  assert.equal(takeTicket(t0 + 6 * 60_000), null);
  assert.equal(inWalletTrip(t0 + 149_000), true);
  assert.equal(inWalletTrip(t0 + 151_000), false);

  appSession.set(null);
  startWalletTrip();
  assert.equal(disk.size, 0);
  disk.set("panda.tg.ticket", "not json");
  assert.equal(takeTicket(), null);
});

test("the session goes to PANDA's own API on this site, and nowhere else", async () => {
  assert.equal(wantsSession("/api/strategy/orders", ORIGIN), true);
  assert.equal(wantsSession(`${ORIGIN}/api/launch`, ORIGIN), true);
  assert.equal(wantsSession("/api/tg/watchlist", ORIGIN), false, "the Mini App's own routes carry the Telegram session themselves");
  assert.equal(wantsSession("/tg/coin/abc?_rsc=1", ORIGIN), false);
  assert.equal(wantsSession("https://api.jup.ag/api/quote", ORIGIN), false);
  assert.equal(wantsSession("https://evil.example/api/x", ORIGIN), false);

  const seen: { url: string; headers: Headers }[] = [];
  const win = {
    location: { origin: ORIGIN },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response("{}");
    },
  } as unknown as Window & typeof globalThis;
  const original = win.fetch;
  const undo = installSessionFetch(win);

  // Not signed in: requests go out untouched.
  await win.fetch("/api/launch", { headers: { "Content-Type": "application/json" } });
  assert.equal(seen[0].headers.get("x-panda-app-session"), null);

  appSession.setInitData("x=1");
  appSession.set(session());
  await win.fetch("/api/launch", { method: "POST", headers: { "Content-Type": "application/json" } });
  assert.equal(seen[1].headers.get("x-panda-app-session"), "tgw1.token");
  assert.equal(seen[1].headers.get("x-tg-init-data"), "x=1");
  assert.equal(seen[1].headers.get("content-type"), "application/json", "what the request already had stays");
  await win.fetch("https://evil.example/api/x");
  await win.fetch("/api/tg/alerts");
  assert.equal(seen[2].headers.get("x-panda-app-session"), null);
  assert.equal(seen[3].headers.get("x-panda-app-session"), null);

  // Closed: the very next request carries nothing.
  appSession.set(null);
  await win.fetch("/api/launch");
  assert.equal(seen[4].headers.get("x-panda-app-session"), null);

  undo();
  assert.equal(win.fetch, original);
});
