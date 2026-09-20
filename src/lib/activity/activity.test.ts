import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { GeckoPool, GeckoTrade } from "@/lib/gecko/client";
import type { PumpCoin } from "@/lib/pump/frontend-api";
import { ACTIVITY_CONFIG as C } from "./config";
import { appendEvent, readJournal, sanitizeEvent } from "./journal";
import { graduationToEvent, launchToEvent, tradeToEvent } from "./mappers";
import { isLarge, mergeFeed } from "./feed";
import { cached, FeedDeps, getFeed } from "./service";
import type { CoinMeta, FeedEvent, StoredEvent } from "./types";

const H = 3_600_000;
const SOL = 1_000_000_000;
const now = 1_800_000_000_000;
const addr = () => Keypair.generate().publicKey.toBase58();
const sig = () => Buffer.from(Keypair.generate().secretKey).toString("hex").slice(0, 0) + Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58().slice(0, 30);
const M1 = addr();
const M2 = addr();

const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({ id: `trade:${Math.random().toString(36).slice(2, 12)}`, kind: "buy", ts: now - H, mint: M1, lamports: 1 * SOL, ...over });

// ---- journal validation --------------------------------------------------------------------

test("sanitizeEvent keeps only well-formed events and only storable fields", () => {
  const good: StoredEvent = { id: "fees:abc123", kind: "fee_distribution", ts: now - 1000, mint: M1, lamports: 5, signature: sig(), wallet: addr(), verified: true };
  assert.deepEqual(sanitizeEvent(good, now), good);

  const dirty = { ...good, ticker: "EVIL<script>", image: "http://x", large: true, name: "n" } as unknown as StoredEvent;
  const clean = sanitizeEvent(dirty, now)!;
  for (const k of ["ticker", "image", "large", "name"]) assert.equal(k in clean, false, `${k} must never be stored`);

  const bad: Partial<StoredEvent>[] = [
    { id: "x" }, { id: "has space in it" }, { kind: "hack" as never }, { mint: "nope" }, { ts: 0 }, { ts: 1.5 }, { ts: now + 10 * 60_000 },
    { wallet: "bad" }, { signature: "short" }, { lamports: -1 }, { lamports: 1.5 }, { tokenAmount: -1 }, { tokenAmount: NaN },
  ];
  for (const b of bad) assert.equal(sanitizeEvent({ ...good, ...b } as StoredEvent, now), null, JSON.stringify(b));
  assert.equal(sanitizeEvent(null as unknown as StoredEvent, now), null);
});

test("journal: appends idempotently by id, refuses junk, and is read back across days", async () => {
  const base: StoredEvent = { id: `claim:${sig()}`, kind: "reward_claim", ts: Date.now() - 1000, mint: M1, lamports: 7, verified: true };
  const t = Date.now();
  assert.equal(await appendEvent(base, t), "added");
  assert.equal(await appendEvent(base, t), "duplicate");
  assert.equal(await appendEvent({ ...base, id: "bad id" }, t), "invalid");

  const yesterday = { ...base, id: `claim:${sig()}`, ts: t - 26 * H };
  assert.equal(await appendEvent(yesterday, t - 24 * H), "added", "written yesterday");
  const ids = (await readJournal(t)).map((e) => e.id);
  assert.ok(ids.includes(base.id) && ids.includes(yesterday.id));
});

test("journal: a day's document is capped", async () => {
  const t = Date.now() + 40 * 24 * H; // a day nothing else uses
  let last = "";
  for (let i = 0; i < C.journalDayCap + 3; i++) last = await appendEvent({ id: `trade:cap-${i}-xxxxxx`, kind: "buy", ts: t - 1000, mint: M2, lamports: 1 }, t);
  assert.equal(last, "full");
});

// ---- mappers ---------------------------------------------------------------------------------------

const gt = (over: Partial<GeckoTrade["attributes"]> = {}): GeckoTrade => ({
  attributes: { block_timestamp: new Date(now - H).toISOString(), tx_hash: "5xSig", tx_from_address: "Trader111", kind: "buy", from_token_amount: "2.5", to_token_amount: "1000000", volume_in_usd: "400", ...over },
});

test("a pool trade becomes an event in exact lamports: a buy pays SOL in, a sell receives SOL out", () => {
  const buy = tradeToEvent(gt(), M1, { ticker: "AAA" })!;
  assert.deepEqual([buy.id, buy.kind, buy.lamports, buy.tokenAmount, buy.signature, buy.ticker], ["trade:5xSig", "buy", 2.5 * SOL, 1_000_000, "5xSig", "AAA"]);
  const sell = tradeToEvent(gt({ kind: "sell", from_token_amount: "300", to_token_amount: "0.75" }), M1, {})!;
  assert.deepEqual([sell.kind, sell.lamports, sell.tokenAmount], ["sell", 0.75 * SOL, 300]);
});

test("junk trades are dropped, never guessed", () => {
  for (const o of [{ tx_hash: "" }, { kind: "swap" as never }, { block_timestamp: "nope" }, { from_token_amount: "abc" }, { from_token_amount: "0" }, { from_token_amount: "-1" }, { to_token_amount: "NaN" }]) {
    assert.equal(tradeToEvent(gt(o), M1, {}), null, JSON.stringify(o));
  }
  assert.equal(tradeToEvent({} as GeckoTrade, M1, {}), null);
});

const pc = (over: Partial<PumpCoin> = {}): PumpCoin => ({ mint: M1, name: "Coin", symbol: "CN", creator: addr(), createdAt: new Date(now - 2 * H).toISOString(), graduated: false, usdMarketCap: 50_000, nsfw: false, banned: false, ...over });

test("launches: only real traction, never flagged coins", () => {
  const e = launchToEvent(pc())!;
  assert.deepEqual([e.id, e.kind, e.ticker, e.ts], [`created:${M1}`, "token_created", "CN", now - 2 * H]);
  assert.equal(launchToEvent(pc({ usdMarketCap: C.launchMinMarketCapUsd - 1 })), null);
  assert.equal(launchToEvent(pc({ nsfw: true })), null);
  assert.equal(launchToEvent(pc({ banned: true })), null);
  assert.equal(launchToEvent(pc({ createdAt: "garbage" })), null);
});

const pool = (created: string | null): GeckoPool =>
  ({ id: "p", attributes: { name: "X / SOL", address: "pool", pool_created_at: created }, relationships: { base_token: { data: { id: `solana_${M1}`, type: "token" } }, quote_token: { data: { id: "q", type: "token" } } } }) as unknown as GeckoPool;

test("graduations: a recent PumpSwap pool of a coin Pump.fun says has graduated, dated by the pool's creation", () => {
  const created = new Date(now - 5 * H).toISOString();
  const e = graduationToEvent(pool(created), M1, pc({ graduated: true }), now)!;
  assert.deepEqual([e.id, e.kind, e.ts], [`grad:${M1}`, "graduation", now - 5 * H]);
  assert.equal(graduationToEvent(pool(created), M1, pc({ graduated: false }), now), null, "not graduated according to Pump.fun");
  assert.equal(graduationToEvent(pool(created), M1, undefined, now), null, "unknown to Pump.fun");
  assert.equal(graduationToEvent(pool(created), M1, pc({ graduated: true, nsfw: true }), now), null);
  assert.equal(graduationToEvent(pool(new Date(now - C.graduationWindowMs - H).toISOString()), M1, pc({ graduated: true }), now), null, "too old");
  assert.equal(graduationToEvent(pool(new Date(now + H).toISOString()), M1, pc({ graduated: true }), now), null, "in the future");
  assert.equal(graduationToEvent(pool(null), M1, pc({ graduated: true }), now), null);
});

// ---- merging -----------------------------------------------------------------------------------------

test("dedupe: the same event from the journal and an indexer is one event, and the PANDA-verified one wins", () => {
  const journal = ev({ id: "trade:same", verified: true });
  const indexer = ev({ id: "trade:same", lamports: 999 });
  const out = mergeFeed({ lists: [[journal], [indexer]], now });
  assert.equal(out.length, 1);
  assert.equal(out[0].verified, true);
  assert.equal(out[0].lamports, journal.lamports);
});

test("implausible times are dropped: too old, in the future, not a number", () => {
  const out = mergeFeed({ lists: [[ev({ id: "trade:ok1" }), ev({ id: "trade:old", ts: now - C.maxAgeMs - 1 }), ev({ id: "trade:fut", ts: now + 10 * 60_000 }), ev({ id: "trade:nan", ts: NaN })]], now });
  assert.deepEqual(out.map((e) => e.id), ["trade:ok1"]);
});

test("large trades are flagged by size and only for trades — a source can't flag its own event", () => {
  assert.equal(isLarge({ kind: "buy", lamports: C.largeTradeLamports }), true);
  assert.equal(isLarge({ kind: "sell", lamports: C.largeTradeLamports - 1 }), false);
  assert.equal(isLarge({ kind: "fee_distribution", lamports: 100 * SOL }), false, "a fee distribution isn't a trade");
  const out = mergeFeed({ lists: [[ev({ id: "trade:big", lamports: 6 * SOL }), ev({ id: "trade:small", lamports: 1 * SOL, large: true }), ev({ id: "fees:x", kind: "fee_distribution", lamports: 50 * SOL, large: true })]], now });
  const by = Object.fromEntries(out.map((e) => [e.id, e.large === true]));
  assert.deepEqual(by, { "trade:big": true, "trade:small": false, "fees:x": false });
  assert.deepEqual(mergeFeed({ lists: [out], filter: "large", now }).map((e) => e.id), ["trade:big"]);
});

test("filters pick the right kinds; mint filter; newest first; limit clamped", () => {
  const all: FeedEvent[] = [
    ev({ id: "trade:b", kind: "buy", ts: now - 5 * H }),
    ev({ id: "trade:s", kind: "sell", ts: now - 4 * H, mint: M2 }),
    ev({ id: "created:1", kind: "token_created", ts: now - 3 * H }),
    ev({ id: "grad:1", kind: "graduation", ts: now - 2 * H }),
    ev({ id: "fees:1", kind: "fee_distribution", ts: now - 1 * H }),
    ev({ id: "claim:1", kind: "reward_claim", ts: now - 30 * 60_000 }),
  ];
  const ids = (filter: Parameters<typeof mergeFeed>[0]["filter"], extra = {}) => mergeFeed({ lists: [all], filter, now, ...extra }).map((e) => e.id);
  assert.deepEqual(ids("all"), ["claim:1", "fees:1", "grad:1", "created:1", "trade:s", "trade:b"], "newest first");
  assert.deepEqual(ids("trades"), ["trade:s", "trade:b"]);
  assert.deepEqual(ids("created"), ["created:1"]);
  assert.deepEqual(ids("graduation"), ["grad:1"]);
  assert.deepEqual(ids("fees"), ["fees:1"]);
  assert.deepEqual(ids("rewards"), ["claim:1"]);
  assert.deepEqual(ids("all", { mint: M2 }), ["trade:s"]);
  assert.equal(mergeFeed({ lists: [all], now, limit: 2 }).length, 2);
  assert.equal(mergeFeed({ lists: [all], now, limit: 0 }).length, 1, "at least one");
  assert.equal(mergeFeed({ lists: [all], now, limit: 10_000 }).length, all.length, "clamped to the maximum, not more than exist");
});

test("names and logos come from the event itself first, then from the coin data", () => {
  const meta = new Map<string, CoinMeta>([[M1, { ticker: "FROM_META", name: "Meta", image: "i" }]]);
  const out = mergeFeed({ lists: [[ev({ id: "fees:a", ticker: "OWN" }), ev({ id: "fees:b" })]], now, meta });
  const t = Object.fromEntries(out.map((e) => [e.id, e.ticker]));
  assert.deepEqual(t, { "fees:a": "OWN", "fees:b": "FROM_META" });
});

test("FUZZ: any mix of events yields unique ids, newest first, within the limit and the time window", () => {
  let seed = 3;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const kinds = ["buy", "sell", "token_created", "fee_distribution", "reward_claim", "graduation"] as const;
  for (let run = 0; run < 200; run++) {
    const lists = Array.from({ length: 3 }, () =>
      Array.from({ length: Math.floor(rnd() * 30) }, () => ev({ id: `e:${Math.floor(rnd() * 25)}`, kind: kinds[Math.floor(rnd() * 6)], ts: now + Math.floor((rnd() - 0.7) * 6 * C.maxAgeMs), lamports: Math.floor(rnd() * 10 * SOL) }))
    );
    const limit = 1 + Math.floor(rnd() * 40);
    const out = mergeFeed({ lists, now, limit });
    assert.ok(out.length <= limit);
    assert.equal(new Set(out.map((e) => e.id)).size, out.length);
    for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].ts >= out[i].ts);
    for (const e of out) assert.ok(e.ts <= now + C.maxFutureMs && now - e.ts <= C.maxAgeMs);
  }
});

// ---- service -----------------------------------------------------------------------------------------------

const deps = (over: Partial<FeedDeps> = {}): FeedDeps => ({
  now: () => now,
  journal: async () => [{ id: "fees:j", kind: "fee_distribution", ts: now - H, mint: M1, lamports: 3 * SOL, verified: true }],
  trades: async () => [ev({ id: "trade:t1", ticker: "AAA" })],
  launches: async () => [ev({ id: "created:l1", kind: "token_created", ticker: "LLL" })],
  graduations: async () => [ev({ id: "grad:g1", kind: "graduation", ticker: "GGG" })],
  meta: async () => new Map([[M1, { ticker: "JOURNALED", name: "N" }]]),
  ...over,
});

test("service: every source contributes and is reported ok; journal events get their names from coin data", async () => {
  const r = await getFeed(deps());
  assert.deepEqual(r.sources, { journal: "ok", trades: "ok", launches: "ok", graduations: "ok" });
  assert.equal(r.events.length, 4);
  assert.equal(r.events.find((e) => e.id === "fees:j")?.ticker, "JOURNALED");
  assert.equal(r.generatedAt, now);
});

test("service: a failing source is reported unavailable and the others still answer", async () => {
  const boom = async () => {
    throw new Error("rate limited");
  };
  const r = await getFeed(deps({ trades: boom, graduations: boom }));
  assert.deepEqual(r.sources, { journal: "ok", trades: "unavailable", launches: "ok", graduations: "unavailable" });
  assert.deepEqual(r.events.map((e) => e.id).sort(), ["created:l1", "fees:j"]);

  const all = await getFeed(deps({ journal: boom, trades: boom, launches: boom, graduations: boom }));
  assert.equal(all.events.length, 0);
  assert.ok(Object.values(all.sources).every((s) => s === "unavailable"));
});

test("service: a failing metadata lookup doesn't break the feed, and only undescribed coins are looked up", async () => {
  let asked: string[] = [];
  const r = await getFeed(deps({ meta: async (m) => ((asked = m), new Map()) }));
  assert.deepEqual(asked, [M1], "only the journal event lacks a name");
  assert.equal(r.events.length, 4);
  const r2 = await getFeed(deps({ meta: async () => { throw new Error("down"); } }));
  assert.equal(r2.events.length, 4);
  assert.equal(r2.events.find((e) => e.id === "fees:j")?.ticker, undefined);
});

test("service: the mint filter and the filter chips are applied", async () => {
  const r = await getFeed(deps({ trades: async (m) => [ev({ id: `trade:${m ?? "all"}`, mint: m ?? M1, ticker: "T" })] }), { mint: M2, filter: "trades" });
  assert.deepEqual(r.events.map((e) => e.id), [`trade:${M2}`]);
});

test("cache: serves within the ttl and refreshes after it; bounded", async () => {
  const c = cached<number>(1000, 2);
  let n = 0;
  const make = async () => ++n;
  assert.equal(await c("a", make, 0), 1);
  assert.equal(await c("a", make, 500), 1);
  assert.equal(await c("a", make, 1500), 2);
  await c("b", make, 1500);
  await c("c", make, 1500); // evicts the oldest key
  assert.equal(await c("a", make, 1600), 5, "a was evicted, so it is rebuilt");
});

// ---- what keeps the feed readable ----------------------------------------------------------------------

test("dust trades are left out, but small fee distributions and rewards are not", () => {
  const out = mergeFeed({
    lists: [[ev({ id: "trade:dust", lamports: C.minTradeLamports - 1 }), ev({ id: "trade:ok", lamports: C.minTradeLamports }), ev({ id: "fees:tiny", kind: "fee_distribution", lamports: 5 }), ev({ id: "claim:tiny", kind: "reward_claim", lamports: 5 })]],
    now,
  });
  assert.deepEqual(out.map((e) => e.id).sort(), ["claim:tiny", "fees:tiny", "trade:ok"]);
});

test("in the mixed view trades can't bury the rarer events, and unused room goes back to trades", () => {
  const trades = Array.from({ length: 100 }, (_, i) => ev({ id: `trade:t${i}`, ts: now - 1000 - i, lamports: SOL }));
  const others = Array.from({ length: 40 }, (_, i) => ev({ id: `grad:g${i}`, kind: "graduation", ts: now - 10 * H - i }));
  const out = mergeFeed({ lists: [trades, others], now, limit: 50 });
  const nTrades = out.filter((e) => e.kind === "buy").length;
  assert.equal(out.length, 50);
  assert.equal(nTrades, Math.ceil(50 * C.allViewTradeShare), "trades reserved 60%");
  assert.equal(out.length - nTrades, 20, "the newest 20 graduations get the rest, though every trade is newer");
  assert.ok(out.some((e) => e.id === "grad:g0") && !out.some((e) => e.id === "grad:g20"));
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].ts >= out[i].ts, "still newest first");

  const fewOthers = mergeFeed({ lists: [trades, others.slice(0, 3)], now, limit: 50 });
  assert.equal(fewOthers.filter((e) => e.kind === "graduation").length, 3);
  assert.equal(fewOthers.length, 50, "room left by the few others goes back to trades");

  assert.equal(mergeFeed({ lists: [trades, others], now, limit: 50, filter: "trades" }).length, 50, "the trades filter isn't capped");
  const coinOnly = mergeFeed({ lists: [trades, others], now, limit: 50, mint: M1 });
  assert.equal(coinOnly.filter((e) => e.kind === "buy").length, 50, "a single coin's own feed is plain newest-first, not rationed");
});
