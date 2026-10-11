import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { setDbForTests } from "@/lib/db/client";
import { telegramUsers } from "@/lib/db/schema";
import { tgUnlinkWallet } from "@/lib/db/telegram";
import { eq } from "drizzle-orm";
import { getSession, getSessionWallet } from "@/lib/auth/session";
import { APP_INIT_DATA_HEADER, APP_INIT_DATA_MAX_AGE_MS, APP_SESSION_HEADER, APP_SESSION_IDLE_MS, APP_SESSION_MAX_MS, appSessionOf, appWalletSession, closeAppSession, startAppSession } from "./app-login";
import { newUserId } from "./testing";

/**
 * PANDA's session in the Mini App: no wallet signature to sign in (Telegram proves the account, /link gives the
 * wallet), 30 minutes from the last use, on the server so a reload loses nothing — and never enough to move money.
 */

const TOKEN = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const T0 = 1_800_000_000_000;

function signInitData(telegramId: number, at: number, token = TOKEN): string {
  const fields: Record<string, string> = { auth_date: String(Math.floor(at / 1000)), query_id: "AAE1", user: JSON.stringify({ id: telegramId, first_name: "Ana", language_code: "es" }) };
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
}

let db: Db;
before(async () => {
  db = await newTestDb();
});

const world = () => {
  const clock = { t: T0 };
  return { clock, d: { db, now: () => clock.t, botToken: TOKEN } };
};
const newWallet = () => bs58.encode(nacl.sign.keyPair().publicKey);
async function user(wallet: string | null = newWallet()) {
  const telegramId = newUserId() + 700_000;
  await db.insert(telegramUsers).values({ telegramId, lang: "es", wallet, linkedAt: wallet ? T0 : null, createdAt: T0, updatedAt: T0 });
  return { telegramId, wallet };
}

test("signing in asks the wallet for nothing: a Telegram account with a linked wallet gets a session as that wallet", async () => {
  const { d } = world();
  const u = await user();
  assert.equal(await appSessionOf(d, u.telegramId), null, "nobody is signed in until they say so");
  const s = await startAppSession(d, u.telegramId);
  assert.deepEqual(s, { ok: true, wallet: u.wallet, startedAt: T0, expiresAt: T0 + APP_SESSION_IDLE_MS });
  assert.equal(APP_SESSION_IDLE_MS, 30 * 60_000);
  assert.deepEqual(await appSessionOf(d, u.telegramId), { wallet: u.wallet, startedAt: T0, expiresAt: T0 + APP_SESSION_IDLE_MS });
});

test("no linked wallet, no session", async () => {
  const { d } = world();
  const u = await user(null);
  assert.deepEqual(await startAppSession(d, u.telegramId), { ok: false, error: "not_linked" });
  assert.equal(await appSessionOf(d, u.telegramId), null);
});

test("it lasts 30 minutes from the last use — through a reload, the wallet app, a locked phone — and no longer", async () => {
  const { d, clock } = world();
  const u = await user();
  await startAppSession(d, u.telegramId);

  // 29 minutes away (in the wallet app, phone locked, Telegram reloading the Mini App): nothing was kept on the phone,
  // so there was nothing to lose. The session is found again from Telegram's own data — and that is a use.
  clock.t = T0 + 29 * 60_000;
  const fresh = signInitData(u.telegramId, clock.t); // a reopened app carries NEW data from Telegram
  assert.deepEqual(await appWalletSession(d, fresh), { wallet: u.wallet, telegramId: u.telegramId, issuedAt: T0 });
  // …so 29 more minutes later it is still live,
  clock.t += 29 * 60_000;
  assert.ok(await appSessionOf(d, u.telegramId));
  // but 30 minutes with no use at all ends it, and then nothing brings it back but signing in again.
  clock.t += APP_SESSION_IDLE_MS;
  assert.equal(await appSessionOf(d, u.telegramId), null);
  assert.equal(await appWalletSession(d, signInitData(u.telegramId, clock.t)), null);
  clock.t += 1000;
  assert.equal(await appSessionOf(d, u.telegramId), null);
  assert.equal((await startAppSession(d, u.telegramId)).ok, true);
  assert.ok(await appSessionOf(d, u.telegramId));
});

test("just asking without counting it as a use does not keep it alive, and there is a hard end even with constant use", async () => {
  const { d, clock } = world();
  const u = await user();
  await startAppSession(d, u.telegramId);
  clock.t = T0 + 20 * 60_000;
  assert.equal((await appSessionOf(d, u.telegramId, false))?.expiresAt, T0 + APP_SESSION_IDLE_MS);
  clock.t = T0 + 31 * 60_000;
  assert.equal(await appSessionOf(d, u.telegramId, false), null);

  const v = await user();
  clock.t = T0;
  await startAppSession(d, v.telegramId);
  for (clock.t = T0; clock.t < T0 + APP_SESSION_MAX_MS; clock.t += 20 * 60_000) assert.ok(await appSessionOf(d, v.telegramId), "used every 20 minutes");
  assert.equal(await appSessionOf(d, v.telegramId), null, "twelve hours at the very most");
});

test("sign out ends it at once", async () => {
  const { d } = world();
  const u = await user();
  await startAppSession(d, u.telegramId);
  assert.equal(await closeAppSession(d, u.telegramId), true);
  assert.equal(await appSessionOf(d, u.telegramId), null);
  assert.equal(await appWalletSession(d, signInitData(u.telegramId, T0)), null);
  assert.equal(await closeAppSession(d, u.telegramId), false);
});

test("another Telegram account, forged or foreign Telegram data, and another wallet are all refused", async () => {
  const { d, clock } = world();
  const u = await user();
  const other = await user();
  await startAppSession(d, u.telegramId);

  // Another account has no session of its own, whatever this one did.
  assert.equal(await appWalletSession(d, signInitData(other.telegramId, T0)), null);
  // Telegram's data that Telegram didn't sign (another bot's token, an edited user id, nothing at all).
  assert.equal(await appWalletSession(d, signInitData(u.telegramId, T0, "999:another-bot")), null);
  assert.equal(await appWalletSession(d, signInitData(other.telegramId, T0).replace(String(other.telegramId), String(u.telegramId))), null);
  for (const junk of [null, undefined, "", "user=%7B%22id%22%3A1%7D&hash=00", 42]) assert.equal(await appWalletSession(d, junk), null);
  // Telegram's data from an opening of the app more than a day ago.
  clock.t = T0 + 60_000;
  assert.equal(await appWalletSession(d, signInitData(u.telegramId, clock.t - APP_INIT_DATA_MAX_AGE_MS - 1000)), null);

  // The wallet is ONLY ever the linked one: unlink it, or link another, and the session is over.
  assert.ok(await appWalletSession(d, signInitData(u.telegramId, clock.t)));
  await db.update(telegramUsers).set({ wallet: newWallet() }).where(eq(telegramUsers.telegramId, u.telegramId));
  assert.equal(await appWalletSession(d, signInitData(u.telegramId, clock.t)), null, "another wallet linked: not the session's wallet any more");
  assert.equal(await appSessionOf(d, u.telegramId), null);
  await startAppSession(d, other.telegramId);
  await tgUnlinkWallet(db, other.telegramId, clock.t);
  assert.equal(await appSessionOf(d, other.telegramId), null);
});

test("on the website's routes the session exists ONLY where a route asks for it by name; everywhere else it is nobody", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { FEATURE_TELEGRAM_BOT: "true", FEATURE_TELEGRAM_MINIAPP: "true", TELEGRAM_BOT_TOKEN: TOKEN });
  setDbForTests(db);
  try {
    const u = await user();
    await startAppSession({ db, now: Date.now }, u.telegramId);
    const req = (initData: string | null) => new Request("https://launchonpanda.app/api/x", { headers: { [APP_SESSION_HEADER]: "1", ...(initData ? { [APP_INIT_DATA_HEADER]: initData } : {}) } });
    const good = signInitData(u.telegramId, Date.now());

    assert.equal(await getSessionWallet(req(good), { linked: true }), u.wallet);
    assert.equal((await getSession(req(good), { linked: true }))?.via, "telegram");
    // The default — every route that doesn't opt in (claims, rewards, referrals, the market, /admin): no session at all.
    assert.equal(await getSessionWallet(req(good)), null);
    assert.equal(await getSession(req(good)), null);
    // And where it is accepted, only with Telegram's real data.
    assert.equal(await getSessionWallet(req(null), { linked: true }), null);
    assert.equal(await getSessionWallet(req(signInitData(u.telegramId, Date.now(), "999:another-bot")), { linked: true }), null);
    // With the Mini App off, it is nobody everywhere.
    process.env.FEATURE_TELEGRAM_MINIAPP = "false";
    assert.equal(await getSessionWallet(req(good), { linked: true }), null);
  } finally {
    setDbForTests(null);
    for (const k of ["FEATURE_TELEGRAM_BOT", "FEATURE_TELEGRAM_MINIAPP", "TELEGRAM_BOT_TOKEN"]) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("no action with money without the wallet's signature: the only routes that accept this session are ones where every change is a signed transaction or the chain's word", () => {
  // Every file under src that passes `linked: true` — the complete list of places the Mini App's session is somebody.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) && /getSession(Wallet)?\(req, \{ linked: true \}\)/.test(readFileSync(p, "utf8").replace(/^\s*(\/\/|\*).*$/gm, ""))) files.push(p.replace(/\\/g, "/"));
    }
  };
  walk("src");
  assert.deepEqual(files.sort(), ["src/app/api/auth/session/route.ts", "src/app/api/strategy/list/route.ts", "src/lib/panda-orders/route.ts", "src/lib/strategy/route.ts"]);

  // The two reads change nothing.
  for (const f of ["src/app/api/auth/session/route.ts", "src/app/api/strategy/list/route.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /export async function (POST|PUT|PATCH|DELETE)/, f);

  // PANDA orders — create, change, cancel: each is a transaction the wallet signs, checked against what the server
  // built, or a fact read back from the chain. The session alone changes nothing.
  const read = (f: string) => readFileSync(f, "utf8");
  assert.match(read("src/app/api/panda-orders/submit/route.ts"), /signed by this wallet/);
  assert.match(read("src/app/api/panda-orders/submit/route.ts"), /signed: b\.signed/);
  assert.match(read("src/app/api/panda-orders/modify/submit/route.ts"), /advance: b\.advance, signed: b\.signed/);
  assert.match(read("src/app/api/panda-orders/close/route.ts"), /The wallet signs and sends it/);
  assert.match(read("src/app/api/panda-orders/closed/route.ts"), /marks what the CHAIN shows as closed/);
  // Strategies: every write also needs Jupiter's own session — which only the wallet's signature gives.
  assert.match(read("src/lib/strategy/route.ts"), /JUPITER_AUTH_REQUIRED/);

  // Buying, selling and launching are transactions the wallet signs and sends itself; their routes only BUILD them
  // and don't take a session at all. And the sign-in routes of the Mini App hold no signing key and send nothing.
  for (const f of ["src/app/api/pump/buy/route.ts", "src/app/api/pump/create/route.ts"]) assert.doesNotMatch(read(f), /getSession/, f);
  for (const f of ["src/lib/telegram/app-login.ts", "src/app/api/tg/login/route.ts"]) assert.doesNotMatch(read(f), /sendTransaction|sendRawTransaction|Keypair|secretKey|signTransaction/, f);
  // The headers the session travels in are the same on both sides.
  assert.ok(read("src/lib/auth/session.ts").includes(`const APP_SESSION_HEADER = "${APP_SESSION_HEADER}"`));
  assert.ok(read("src/components/tg/session.ts").includes(`const HEADER = "${APP_SESSION_HEADER}"`) && read("src/components/tg/session.ts").includes(`const INIT_DATA_HEADER = "${APP_INIT_DATA_HEADER}"`));
});
