import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { holderPayoutRuns, pandaLaunches } from "@/lib/db/schema";
import { tgSetState } from "@/lib/db/telegram";
import { buildAnnouncement, describeSplit, postNewLaunches, postPandaBuys, postPayoutDigest, type BuyTrade, type FeedDeps } from "./feeds";
import { coin, fakeMarket, PANDA, queued, testConfig } from "./testing";

let db: Db;
before(async () => {
  db = await newTestDb();
});

const TREASURY = "DCZaeTXLDwkwE4a8xayS3o9hCiPwgH1deotvyS5VEE6n";
const POOL = "REWARDSPOOL1111111111111111111111111111111";
const CREATOR = "35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh";

function feeds(over: Partial<FeedDeps> = {}, groupId = "-1100"): FeedDeps & { clock: { t: number } } {
  const clock = { t: 2_100_000_000_000 };
  return {
    db,
    now: () => clock.t,
    cfg: testConfig({ groupId }),
    market: fakeMarket(),
    pandaMint: PANDA,
    feeSplit: async () => [{ address: TREASURY, shareBps: 500 }, { address: CREATOR, shareBps: 3000 }, { address: POOL, shareBps: 6500 }],
    feeLockPending: async () => false,
    trades: async () => [],
    treasury: TREASURY,
    rewardsPool: POOL,
    ...over,
    clock,
  };
}

test("fee split is described from the on-chain shares: PANDA / creator / holders / partner", () => {
  assert.equal(describeSplit([{ address: TREASURY, shareBps: 500 }, { address: CREATOR, shareBps: 3000 }, { address: POOL, shareBps: 6000 }, { address: "X", shareBps: 500 }], { treasury: TREASURY, rewardsPool: POOL, creator: CREATOR }), "PANDA 5% · creator 30% · holders 60% · partner 5%");
  assert.equal(describeSplit(null, { treasury: TREASURY, rewardsPool: POOL, creator: CREATOR }), "not readable right now");
});

test("new PANDA launches: the first run never posts history; each new launch is posted once, with image, split and link", async () => {
  await db.insert(pandaLaunches).values({ mint: "OLDMINT", creator: CREATOR, launchedAt: 1_000 });
  const d = feeds({ market: fakeMarket({ coins: { NEWMINT: coin("NEWMINT", { ticker: "NEW", name: "New One", image: "https://img/x.png" }) } }) }, "-1101");
  assert.equal(await postNewLaunches(d), 0, "first run: cursor at the latest existing launch");
  await db.insert(pandaLaunches).values({ mint: "NEWMINT", creator: CREATOR, launchedAt: 2_000 });
  assert.equal(await postNewLaunches(d), 1);
  assert.equal(await postNewLaunches(d), 0, "never twice");
  const q = await queued(db, "-1101");
  assert.equal(q.length, 1);
  assert.equal(q[0].row.method, "sendPhoto");
  assert.equal(q[0].payload.message_thread_id, 11, "the New coins topic");
  assert.match(q[0].text, /New One[\s\S]*\$NEW[\s\S]*PANDA 5% · creator 30% · holders 65%[\s\S]*NEWMINT[\s\S]*Not financial advice/);
});

test("a launch whose fee split isn't on-chain yet waits (like the site), and nothing after it jumps the queue", async () => {
  await db.insert(pandaLaunches).values({ mint: "LOCKED1", creator: CREATOR, launchedAt: 3_000 });
  let pending = true;
  const d = feeds({ feeLockPending: async (m) => pending && m === "LOCKED1", market: fakeMarket({ coins: { LOCKED1: coin("LOCKED1") } }) }, "-1101");
  d.clock.t = 3_000 + 60_000;
  assert.equal(await postNewLaunches(d), 0);
  pending = false;
  assert.equal(await postNewLaunches(d), 1);
});

test("$PANDA buys: first run starts now; only buys ≥ the minimum are posted, once each; a failed read moves nothing", async () => {
  const group = "-1102";
  let trades: BuyTrade[] = [];
  let fail = false;
  const d = feeds({ trades: async () => { if (fail) throw new Error("gecko down"); return trades; } }, group);
  assert.equal(await postPandaBuys(d), 0, "first run: cursor = now");
  const t0 = d.clock.t;
  trades = [
    { txHash: "SIG_BIG", wallet: CREATOR, kind: "buy", usd: 55, sol: 0.3, at: t0 + 1000 },
    { txHash: "SIG_SMALL", wallet: CREATOR, kind: "buy", usd: 5, sol: 0.02, at: t0 + 2000 },
    { txHash: "SIG_SELL", wallet: CREATOR, kind: "sell", usd: 500, sol: null, at: t0 + 3000 },
    { txHash: "SIG_OLD", wallet: CREATOR, kind: "buy", usd: 99, sol: 1, at: t0 - 60_000 },
  ];
  d.clock.t += 60_000;
  assert.equal(await postPandaBuys(d), 1);
  assert.equal(await postPandaBuys(d), 0, "the same buy is never posted twice");
  const q = await queued(db, group);
  assert.equal(q.length, 1);
  assert.match(q[0].text, /\$PANDA buy[\s\S]*\$55[\s\S]*0\.3 SOL[\s\S]*solscan\.io\/tx\/SIG_BIG/);
  assert.equal(q[0].payload.message_thread_id, 12);
  fail = true;
  await assert.rejects(postPandaBuys(d));
});

test("a burst of buys: the first five are posted, then ONE line for the rest", async () => {
  const group = "-1103";
  let trades: BuyTrade[] = [];
  const d = feeds({ trades: async () => trades }, group);
  d.clock.t = 2_300_000_000_000;
  await tgSetState(db, "buys.cursor", d.clock.t, d.clock.t); // the cursor is global: start this test from its own "now"
  trades = Array.from({ length: 8 }, (_, i) => ({ txHash: `BURST${i}`, wallet: CREATOR, kind: "buy" as const, usd: 30 + i, sol: null, at: d.clock.t + i }));
  d.clock.t += 1000;
  assert.equal(await postPandaBuys(d), 5);
  const q = await queued(db, group);
  assert.equal(q.length, 6);
  assert.match(q[5].text, /3 more \$PANDA buys/);
});

test("holder payouts: one digest an hour, each coin once in it, only rounds that really paid", async () => {
  const group = "-1104";
  const d = feeds({ market: fakeMarket({ coins: { PAYMINT: coin("PAYMINT", { ticker: "PAY" }) } }) }, group);
  assert.equal(await postPayoutDigest(d), 0, "first run: starts now");
  const at = new Date(d.clock.t + 1000);
  await db.insert(holderPayoutRuns).values([
    { id: randomUUID(), mint: "PAYMINT", status: "done", holdersPaid: 3, lamportsPaid: 1_500_000_000, startedAt: at, finishedAt: at },
    { id: randomUUID(), mint: "PAYMINT", status: "done", holdersPaid: 2, lamportsPaid: 500_000_000, startedAt: at, finishedAt: at },
    { id: randomUUID(), mint: "PAYMINT", status: "failed", holdersPaid: 0, lamportsPaid: 0, startedAt: at, finishedAt: at },
  ]);
  d.clock.t += 30 * 60_000;
  assert.equal(await postPayoutDigest(d), 0, "not an hour yet");
  d.clock.t += 31 * 60_000;
  assert.equal(await postPayoutDigest(d), 1);
  const q = await queued(db, group);
  assert.equal(q.length, 1);
  assert.match(q[0].text, /\$PAY: 2 SOL to 5 holders/);
  d.clock.t += 61 * 60_000;
  assert.equal(await postPayoutDigest(d), 0, "nothing new: no post");
});

test("no group configured: nothing is posted (and nothing breaks)", async () => {
  const d = feeds({}, "");
  d.cfg.groupId = null;
  assert.equal(await postPandaBuys(d), 0);
  assert.equal(await postPayoutDigest(d), 0);
});

test("announcements: plain text (escaped), https only, button needs label + link, limits by type", () => {
  const ok = buildAnnouncement({ text: "Hello <b>world</b> & co", buttonText: "Open", buttonUrl: "https://launchonpanda.app" }, "-100");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.message.payload.text, "Hello &lt;b&gt;world&lt;/b&gt; &amp; co");
    assert.deepEqual(ok.message.payload.reply_markup, { inline_keyboard: [[{ text: "Open", url: "https://launchonpanda.app" }]] });
  }
  assert.equal(buildAnnouncement({ text: "" }, "-100").ok, false);
  assert.equal(buildAnnouncement({ text: "x", imageUrl: "http://insecure/x.png" }, "-100").ok, false);
  assert.equal(buildAnnouncement({ text: "x", buttonText: "Open" }, "-100").ok, false);
  assert.equal(buildAnnouncement({ text: "x", buttonText: "Open", buttonUrl: "javascript:alert(1)" }, "-100").ok, false);
  assert.equal(buildAnnouncement({ text: "x".repeat(1001), imageUrl: "https://img/x.png" }, "-100").ok, false);
  const photo = buildAnnouncement({ text: "x", imageUrl: "https://img/x.png" }, "-100");
  assert.equal(photo.ok && photo.message.method, "sendPhoto");
});
