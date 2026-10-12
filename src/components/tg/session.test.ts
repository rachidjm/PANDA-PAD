import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { clearOp, noteContinuation, OP_MAX_AGE_MS, readOp, relayOfStartParam, saveOp, settleOp, takeContinuation, type PendingOp } from "@/lib/wallet/deeplink/ops";
import { completeOp } from "./resume";
import { appSession, installSessionFetch, wantsSession } from "./session";

/**
 * The phone's side of the Mini App's session, and the way back from the wallet: nothing of the session is kept on the
 * phone, and an operation that was in the wallet when Telegram reopened the app is finished, not started over.
 */

const disk = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => disk.get(k) ?? null,
  setItem: (k: string, v: string) => void disk.set(k, v),
  removeItem: (k: string) => void disk.delete(k),
};

const ORIGIN = "https://launchonpanda.app";
const RELAY = "R".repeat(32);
const T0 = 1_800_000_000_000;

beforeEach(() => {
  disk.clear();
  appSession.set(null);
  appSession.setInitData("");
  takeContinuation();
});

test("the session is not on the phone: no token, no cookie, nothing in storage — only Telegram's own data travels", () => {
  appSession.setInitData("query_id=1&hash=abc");
  appSession.set({ wallet: "Wa11et", expiresAt: T0 });
  assert.deepEqual(appSession.headers(), { "x-panda-app-session": "1", "x-tg-init-data": "query_id=1&hash=abc" });
  assert.equal(disk.size, 0);
  appSession.set(null); // signed out, or the server said it is over
  assert.deepEqual(appSession.headers(), {});
  appSession.setInitData("");
  appSession.set({ wallet: "Wa11et", expiresAt: T0 });
  assert.deepEqual(appSession.headers(), {}, "without Telegram's data there is nothing to send");
  const src = readFileSync("src/components/tg/session.ts", "utf8");
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie|CloudStorage/);
  // A reload finds the session again from the server: Telegram's sign-in answers with it.
  assert.ok(readFileSync("src/app/api/tg/session/route.ts", "utf8").includes("app: app ? { wallet: app.wallet, expiresAt: app.expiresAt } : null"));
  assert.ok(readFileSync("src/components/tg/TgShell.tsx", "utf8").includes("appSession.set(data.app?.wallet ?"));
});

test("it goes to PANDA's own API on this site, and nowhere else", async () => {
  assert.equal(wantsSession("/api/panda-orders/list", ORIGIN), true);
  assert.equal(wantsSession("/api/tg/watchlist", ORIGIN), false);
  assert.equal(wantsSession("/tg/coin/abc?_rsc=1", ORIGIN), false);
  assert.equal(wantsSession("https://evil.example/api/x", ORIGIN), false);
  const seen: Headers[] = [];
  const win = { location: { origin: ORIGIN }, fetch: async (_i: RequestInfo | URL, init?: RequestInit) => (seen.push(new Headers(init?.headers)), new Response("{}")) } as unknown as Window & typeof globalThis;
  const undo = installSessionFetch(win);
  await win.fetch("/api/panda-orders/list");
  appSession.setInitData("x=1");
  appSession.set({ wallet: "Wa11et", expiresAt: T0 });
  await win.fetch("/api/panda-orders/list", { headers: { "Content-Type": "application/json" } });
  await win.fetch("https://evil.example/api/x");
  appSession.set(null);
  await win.fetch("/api/panda-orders/list");
  assert.deepEqual(seen.map((h) => h.get("x-tg-init-data")), [null, "x=1", null, null]);
  assert.equal(seen[1].get("content-type"), "application/json");
  undo();
});

// ── the way back from the wallet ────────────────────────────────────────────────────────────────────────────────────
const op = (over: Partial<PendingOp> = {}): PendingOp => ({ relayId: RELAY, provider: "phantom", method: "signAndSendTransaction", path: "/tg/coin/zefa42tKR24WwpYZJujta7CDkD43n47soQwCoJpanda", at: T0, then: [], ...over });

test("a request leaves a note before the wallet opens: which answer, which screen, what completes it — and no key or signature", () => {
  noteContinuation([{ url: "/api/portfolio/record-trade", body: { mint: "M", side: "buy" }, put: "signature" }]);
  const steps = takeContinuation();
  assert.equal(steps.length, 1);
  assert.deepEqual(takeContinuation(), [], "read once: it never attaches to a later request");
  saveOp(op({ then: steps }));
  assert.deepEqual(readOp(T0 + 60_000), op({ then: steps }));
  assert.doesNotMatch([...disk.values()].join(""), /secret|session|signature":/i);
  // Telegram's link back carries the slot's one-time code, and only that shape is believed.
  assert.equal(relayOfStartParam(`r_${RELAY}`), RELAY);
  for (const bad of ["back", `c_${RELAY}`, "r_short", `r_${RELAY}x`, undefined, null]) assert.equal(relayOfStartParam(bad), null, String(bad));
  // Useless after a few minutes; and a note that points outside the app is not a note.
  assert.equal(readOp(T0 + OP_MAX_AGE_MS + 1), null);
  saveOp(op({ path: "/admin" }));
  assert.equal(readOp(T0), null);
  saveOp(op());
  clearOp("another");
  assert.ok(readOp(T0));
  clearOp(RELAY);
  assert.equal(readOp(T0), null);
});

test("a buy or sell the wallet already sent: the reopened app says so and records it — it is never sent again", async () => {
  const calls: [string, unknown][] = [];
  const fetcher = async (url: string, init?: RequestInit) => (calls.push([url, JSON.parse(String(init?.body))]), new Response("{}"));
  const steps = [{ url: "/api/portfolio/record-trade", body: { wallet: "W", mint: "M", ticker: "T", side: "sell" }, put: "signature" as const, confirmed: true }];
  const out = await completeOp(op({ then: steps }), { signature: "5igNaTuRe" }, fetcher, async () => true);
  assert.deepEqual(out, { phase: "sent", signature: "5igNaTuRe" });
  assert.deepEqual(calls, [["/api/portfolio/record-trade", { wallet: "W", mint: "M", ticker: "T", side: "sell", signature: "5igNaTuRe" }]]);
  // Not confirmed by the chain: nothing is recorded, and the user is still told what the wallet did.
  calls.length = 0;
  assert.deepEqual(await completeOp(op({ then: steps }), { signature: "5igNaTuRe" }, fetcher, async () => false), { phase: "sent", signature: "5igNaTuRe" });
  assert.deepEqual(calls, []);
  assert.deepEqual(await completeOp(op(), {}, fetcher), { phase: "error" });
  // Nothing in what finishes an operation can sign anything: it only delivers what the wallet signed, to the places the note names.
  assert.doesNotMatch(readFileSync("src/components/tg/resume.ts", "utf8"), /sendRawTransaction|Keypair|signTransaction\(|signAllTransactions\(/);
});

test("orders signed in the wallet (Draw Your Trade): the reopened app delivers them to the same route, in the same shape", async () => {
  const calls: [string, { groupId: string; signed: { id: string; transaction: string }[] }][] = [];
  const fetcher = async (url: string, init?: RequestInit) => (calls.push([url, JSON.parse(String(init?.body))]), new Response("{}"));
  const raw = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([9, 8, 7])];
  const steps = [{ url: "/api/panda-orders/submit", body: { groupId: "g1" }, put: "orders" as const, ids: ["o1", "o2"] }];
  const out = await completeOp(op({ method: "signAllTransactions", then: steps }), { transactions: raw.map((b) => bs58.encode(b)) }, fetcher);
  assert.deepEqual(out, { phase: "done" });
  assert.equal(calls[0][0], "/api/panda-orders/submit");
  assert.equal(calls[0][1].groupId, "g1");
  assert.deepEqual(calls[0][1].signed.map((s) => [s.id, [...Buffer.from(s.transaction, "base64")]]), [["o1", [1, 2, 3, 4]], ["o2", [9, 8, 7]]], "what the wallet signed, byte for byte, as base64");
  // The server refuses: its reason is what the user reads.
  const refuse = async () => new Response(JSON.stringify({ error: "The price moved." }), { status: 409 });
  assert.deepEqual(await completeOp(op({ method: "signAllTransactions", then: steps }), { transactions: raw.map((b) => bs58.encode(b)) }, refuse), { phase: "error", message: "The price moved." });
  // Fewer signed than asked: nothing is delivered.
  calls.length = 0;
  assert.deepEqual(await completeOp(op({ method: "signAllTransactions", then: steps }), { transactions: [bs58.encode(raw[0])] }, fetcher), { phase: "error" });
  assert.deepEqual(calls, []);
  // A signature whose next step only the old copy of the app knew: nothing is sent, and the screen asks to do it again.
  assert.deepEqual(await completeOp(op({ method: "signAllTransactions" }), { transactions: [bs58.encode(raw[0])] }, fetcher), { phase: "repeat" });
  assert.deepEqual(await completeOp(op({ method: "signMessage" }), { signature: "x" }, fetcher), { phase: "repeat" });
  assert.deepEqual(calls, []);
});

test("if the copy of the app that asked is still alive and finished it, the reopened one shows the result instead of doing it again", () => {
  saveOp(op());
  settleOp(RELAY, { ok: true, signature: "5igNaTuRe" });
  assert.deepEqual(readOp(T0)?.settled, { ok: true, signature: "5igNaTuRe" });
  const shell = readFileSync("src/components/tg/TgShell.tsx", "utf8");
  assert.ok(shell.includes("if (op.settled) {") && shell.includes("return void setResumed(op.settled.ok ?"), "a settled operation is shown, not repeated");
  assert.ok(shell.includes("if (op && code && op.relayId === code) {") && shell.includes("if (op.path !== pathRef.current) router.replace(op.path);") && shell.includes("signIn().then((ok) => ok && afterSignIn());"), "same screen, same coin");
  // Also when Telegram simply reloaded the app (no code in its link): looked for quietly, finished if the answer is there.
  assert.ok(shell.includes('} else if (op && op.method !== "connect") {') && shell.includes("finishOp(op, true);") && shell.includes("if (quiet) return;"));
  // The website's own code is what says how each operation is completed.
  assert.ok(readFileSync("src/components/coin/TradingPanel.tsx", "utf8").includes('noteContinuation(publicKey && (side === "sell" || paidInSol) ? [{ url: "/api/portfolio/record-trade"'));
  const draw = readFileSync("src/components/coin/draw/useDrawTrade.ts", "utf8");
  assert.ok(draw.includes('noteContinuation([{ url: "/api/panda-orders/submit", body: { groupId: d.id }, put: "orders", ids: p.orders.map((o) => o.id) }]);'));
  assert.ok(draw.includes('noteContinuation([{ url: "/api/panda-orders/closed", body: { nonceAccounts: data.nonceAccounts }, confirmed: true }]);'));
});

test("a launch approved together with its first buy: the reopened app sends both, in order, and never the buy before the launch has landed", async () => {
  const raw = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
  const answer = { transactions: raw.map((b) => bs58.encode(b)) };
  const steps = [
    { url: "/api/rpc", body: {}, put: "send" as const },
    { url: "/api/portfolio/record-trade", body: { mint: "M", side: "buy" }, put: "signature" as const, confirmed: true },
  ];
  const mk = (results: (string | null)[]) => {
    const sent: string[] = [];
    const recorded: unknown[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url === "/api/rpc") {
        assert.equal(body.method, "sendTransaction");
        // Preflight on: the network simulates it before taking it.
        assert.equal(body.params[1].skipPreflight, false);
        sent.push(body.params[0]);
        const r = results[sent.length - 1];
        return new Response(JSON.stringify(r ? { result: r } : { error: { message: "would fail" } }));
      }
      recorded.push([url, body]);
      return new Response("{}");
    };
    return { sent, recorded, fetcher };
  };
  const b64 = raw.map((b) => Buffer.from(b).toString("base64"));
  const made = (then = steps) => ({ relayId: "r".repeat(32), provider: "phantom" as const, method: "signAllTransactions" as const, path: "/tg/create", at: Date.now(), then });

  // Both land: the launch's signature is what the user is told; the buy is recorded as a trade.
  let w = mk(["LAUNCH", "BUY"]);
  assert.deepEqual(await completeOp(made(), answer, w.fetcher, async () => true), { phase: "sent", signature: "LAUNCH" });
  assert.deepEqual(w.sent, b64);
  assert.deepEqual(w.recorded, [["/api/portfolio/record-trade", { mint: "M", side: "buy", signature: "BUY" }]]);

  // The launch is refused by the network: the buy is never sent, nothing is recorded.
  w = mk([null, "BUY"]);
  assert.deepEqual(await completeOp(made(), answer, w.fetcher, async () => true), { phase: "error" });
  assert.deepEqual(w.sent, [b64[0]]);
  assert.deepEqual(w.recorded, []);

  // The launch was sent but never confirmed: the buy waits (it is not sent).
  w = mk(["LAUNCH", "BUY"]);
  assert.deepEqual(await completeOp(made(), answer, w.fetcher, async () => false), { phase: "error" });
  assert.deepEqual(w.sent, [b64[0]]);

  // The launch lands and the buy is refused: the coin exists, no trade is recorded.
  w = mk(["LAUNCH", null]);
  assert.deepEqual(await completeOp(made(), answer, w.fetcher, async () => true), { phase: "sent", signature: "LAUNCH" });
  assert.deepEqual(w.recorded, []);

  // No signed transactions in the answer.
  w = mk([]);
  assert.deepEqual(await completeOp(made(), {}, w.fetcher, async () => true), { phase: "error" });
  assert.deepEqual(w.sent, []);
});
