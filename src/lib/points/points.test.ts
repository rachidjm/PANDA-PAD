import { test } from "node:test";
import assert from "node:assert/strict";
import { POINTS_CONFIG } from "./config";
import { isqrt, tradePointsDelta, tradePointsForVolume } from "./math";
import { applyAward, AwardInput, chainEventId, emptyWalletDoc, walletTotal, WalletEpochDoc } from "./events";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const MIN = POINTS_CONFIG.trade.minVolumeLamports;
const SOL = 1_000_000_000;

// ---- math ----------------------------------------------------------------

test("isqrt is exact (fuzz against the definition, incl. perfect squares and their neighbours)", () => {
  const rand = rng(1);
  for (let i = 0; i < 3000; i++) {
    const n = Math.floor(rand() * Number.MAX_SAFE_INTEGER);
    const r = isqrt(n);
    assert.ok(BigInt(r) * BigInt(r) <= BigInt(n) && BigInt(r + 1) * BigInt(r + 1) > BigInt(n), String(n));
  }
  for (const r of [0, 1, 2, 3, 1000, 94906265]) {
    assert.equal(isqrt(r * r), r);
    if (r > 0) {
      assert.equal(isqrt(r * r - 1), r - 1);
      assert.equal(isqrt(r * r + 1), r);
    }
  }
  assert.equal(isqrt(Number.MAX_SAFE_INTEGER), 94906265);
});

test("isqrt rejects negatives, fractions, NaN, Infinity", () => {
  for (const bad of [-1, 1.5, NaN, Infinity]) assert.throws(() => isqrt(bad), RangeError);
});

test("trade points follow the square root of cumulative volume", () => {
  assert.equal(tradePointsForVolume(0), 0);
  assert.equal(tradePointsForVolume(1 * SOL), 31);
  assert.equal(tradePointsForVolume(10 * SOL), 100); // 10x volume -> ~3x points
  assert.equal(tradePointsForVolume(100 * SOL), 316);
  assert.equal(tradePointsForVolume(10_000 * SOL), 3162); // 1000x volume of 10 SOL -> ~31x points
  for (const bad of [-1, NaN, 1.5, Infinity]) assert.equal(tradePointsForVolume(bad), 0);
});

test("a trade below the minimum earns nothing", () => {
  assert.equal(tradePointsDelta(0, MIN - 1), 0);
  assert.equal(tradePointsDelta(0, 0), 0);
  assert.equal(tradePointsDelta(0, NaN), 0);
  assert.equal(tradePointsDelta(5 * SOL, MIN - 1), 0);
});

// ---- awards --------------------------------------------------------------

const base = (over: Partial<AwardInput> = {}): AwardInput => ({
  eventId: chainEventId("5".repeat(60), 2, "campaign"),
  wallet: "W",
  type: "campaign",
  source: "campaign:spring",
  ts: 1000,
  points: 40,
  epoch: 1,
  reason: "test",
  ...over,
});

const trade = (id: string, volumeLamports: number): AwardInput => ({
  eventId: `${id}:0:trade`,
  wallet: "W",
  type: "trade",
  source: "trade:MINT",
  ts: 1000,
  volumeLamports,
  epoch: 1,
  reason: "test",
});

test("SPLITTING a volume into many trades earns exactly what one big trade would (path independence)", () => {
  const rand = rng(5);
  for (let run = 0; run < 300; run++) {
    // Random volumes, each at or above the minimum.
    const volumes = Array.from({ length: 1 + Math.floor(rand() * 60) }, () => MIN + Math.floor(rand() * 3 * SOL));
    let doc = emptyWalletDoc("W", 1);
    volumes.forEach((v, i) => (doc = applyAward(doc, trade(`sig${run}x${i}`, v), 1).next));
    const totalVolume = volumes.reduce((a, b) => a + b, 0);
    const expected = Math.min(tradePointsForVolume(totalVolume), POINTS_CONFIG.caps.perWalletPerEpochByType.trade);
    assert.equal(walletTotal(doc), expected, `run ${run}`);
  }
  // The specific case the first design got wrong: 200 minimum trades vs one trade of the same total volume.
  let many = emptyWalletDoc("W", 1);
  for (let i = 0; i < 200; i++) many = applyAward(many, trade(`m${i}`, MIN), 1).next;
  const one = applyAward(emptyWalletDoc("W", 1), trade("big", 200 * MIN), 1).next;
  assert.equal(walletTotal(many), walletTotal(one));
});

test("trade rules: points can't be supplied, volume must be an integer at or above the minimum", () => {
  const doc = emptyWalletDoc("W", 1);
  assert.equal(applyAward(doc, { ...trade("a1234567", SOL), points: 999 }, 1).outcome, "rejected");
  for (const v of [MIN - 1, 0, -SOL, 1.5 * SOL + 0.5, NaN, Infinity, undefined]) {
    const r = applyAward(doc, { ...trade("a1234567", 0), volumeLamports: v as number }, 1);
    assert.equal(r.outcome, "rejected", String(v));
  }
  assert.equal(applyAward(doc, { ...base(), volumeLamports: SOL }, 1).outcome, "rejected", "volume on a non-trade type");
  assert.equal(applyAward(doc, trade("a1234567", SOL), 1).outcome, "recorded");
});

test("trade cap: points stop at the per-type cap and further trades are refused as capped", () => {
  const cap = POINTS_CONFIG.caps.perWalletPerEpochByType.trade;
  let doc: WalletEpochDoc = emptyWalletDoc("W", 1);
  let last = "";
  for (let i = 0; i < 80; i++) {
    const r = applyAward(doc, trade(`c${i}`, 1_000_000 * SOL), 1); // 1M SOL each: far past the cap quickly
    doc = r.next;
    last = r.outcome;
    assert.ok(walletTotal(doc) <= cap);
  }
  assert.equal(walletTotal(doc), cap);
  assert.equal(last, "capped");
});

test("recording an event, and the same event again, counts once (idempotent)", () => {
  const doc = emptyWalletDoc("W", 1);
  const a = applyAward(doc, base(), 5);
  assert.equal(a.outcome, "recorded");
  assert.equal(a.awarded, 40);
  const b = applyAward(a.next, base(), 6);
  assert.equal(b.outcome, "duplicate");
  assert.equal(walletTotal(b.next), 40);
  assert.equal(b.next.events.length, 1);
  // Same for trades: replaying a trade event never adds volume or points.
  const t1 = applyAward(doc, trade("dup1234", SOL), 5);
  const t2 = applyAward(t1.next, trade("dup1234", SOL), 6);
  assert.equal(t2.outcome, "duplicate");
  assert.equal(walletTotal(t2.next), walletTotal(t1.next));
});

test("never mutates its input", () => {
  const doc = emptyWalletDoc("W", 1);
  const snapshot = JSON.stringify(doc);
  applyAward(doc, base(), 5);
  applyAward(doc, trade("abc12345", SOL), 5);
  assert.equal(JSON.stringify(doc), snapshot);
});

test("bad input is rejected: wrong wallet/epoch, zero/negative/fractional/NaN points, bad ids, unknown type, long reason", () => {
  const doc = emptyWalletDoc("W", 1);
  const cases: Partial<AwardInput>[] = [
    { wallet: "OTHER" },
    { epoch: 2 },
    { points: 0 },
    { points: -5 },
    { points: 1.5 },
    { points: NaN },
    { points: Infinity },
    { points: undefined },
    { points: Number.MAX_SAFE_INTEGER + 2 },
    { eventId: "short" },
    { eventId: "has spaces in it.." },
    { eventId: "../../etc/passwd" },
    { type: "made_up" as never },
    { ts: 0 },
    { ts: 1.5 },
    { reason: "x".repeat(201) },
  ];
  for (const over of cases) {
    const r = applyAward(doc, base(over), 5);
    assert.equal(r.outcome, "rejected", JSON.stringify(over));
    assert.equal(r.next, doc);
  }
});

test("per-type cap trims the last award and then refuses", () => {
  const cap = POINTS_CONFIG.caps.perWalletPerEpochByType.campaign;
  let doc: WalletEpochDoc = emptyWalletDoc("W", 1);
  let i = 0;
  while (walletTotal(doc) <= cap - 300) doc = applyAward(doc, base({ eventId: `evt-${i++}-campaign`, points: 300 }), 5).next;
  const near = applyAward(doc, base({ eventId: "evt-last-campaign", points: 300 }), 5);
  assert.equal(near.outcome, "recorded");
  assert.equal(walletTotal(near.next), cap, "trimmed to exactly the cap");
  const over = applyAward(near.next, base({ eventId: "evt-over-campaign", points: 10 }), 5);
  assert.equal(over.outcome, "capped");
  assert.equal(walletTotal(over.next), cap);
});

test("per-wallet total cap spans types", () => {
  let doc: WalletEpochDoc = emptyWalletDoc("W", 1);
  const types = ["token_launch", "theme_participation", "nft_create", "nft_buy", "campaign", "early_participation"] as const;
  let n = 0;
  for (const type of types) for (let k = 0; k < 40; k++) doc = applyAward(doc, base({ eventId: `evt-${n++}-${type}`, type, points: 250 }), 5).next;
  doc = applyAward(doc, trade("last-one-1", 1_000_000 * SOL), 5).next;
  assert.ok(walletTotal(doc) <= POINTS_CONFIG.caps.perWalletPerEpochTotal);
});

test("event-count limit stops storage growth", () => {
  let doc: WalletEpochDoc = emptyWalletDoc("W", 1);
  for (let i = 0; i < POINTS_CONFIG.caps.maxEventsPerWallet; i++) {
    const ev = applyAward(emptyWalletDoc("W", 1), base({ eventId: `evt-${i}-campaign`, points: 1 }), 5).next.events[0];
    doc = { ...doc, events: [...doc.events, ev] };
  }
  const r = applyAward(doc, base({ eventId: "one-more-campaign" }), 5);
  assert.equal(r.outcome, "rejected");
  assert.equal((r as { reason: string }).reason, "event_limit");
});

test("corrections: need a target and a non-zero amount, can be negative, and total never goes below zero", () => {
  const doc = applyAward(emptyWalletDoc("W", 1), base({ points: 100 }), 5).next;
  assert.equal(applyAward(doc, base({ eventId: "correction:c1", type: "correction", points: -30 }), 6).outcome, "rejected"); // no target
  assert.equal(applyAward(doc, base({ eventId: "correction:c1", type: "correction", points: 0, correctsEventId: "x" }), 6).outcome, "rejected");
  const c = applyAward(doc, base({ eventId: "correction:c1", type: "correction", points: -30, correctsEventId: "orig" }), 6);
  assert.equal(c.outcome, "recorded");
  assert.equal(walletTotal(c.next), 70);
  const big = applyAward(c.next, base({ eventId: "correction:c2", type: "correction", points: -10_000, correctsEventId: "orig" }), 7);
  assert.equal(walletTotal(big.next), 0);
});

test("held events don't count towards points or trade volume", () => {
  const doc = applyAward(emptyWalletDoc("W", 1), trade("held1234", 4 * SOL), 5).next;
  const held: WalletEpochDoc = { ...doc, events: doc.events.map((e) => ({ ...e, status: "held" as const })) };
  assert.equal(walletTotal(held), 0);
  const after = applyAward(held, trade("next1234", 1 * SOL), 6);
  assert.equal(walletTotal(after.next), tradePointsForVolume(1 * SOL));
});

test("fuzz: any mix of awards keeps every invariant", () => {
  const rand = rng(99);
  const types = ["trade", "token_launch", "nft_buy", "campaign"] as const;
  for (let run = 0; run < 200; run++) {
    let doc: WalletEpochDoc = emptyWalletDoc("W", 1);
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const type = types[Math.floor(rand() * types.length)];
      const id = `evt-${Math.floor(rand() * 60)}-${type}`; // collisions on purpose
      const input: AwardInput =
        type === "trade"
          ? { ...trade("x", MIN + Math.floor(rand() * 20 * SOL)), eventId: id }
          : base({ eventId: id, type, points: 1 + Math.floor(rand() * 400) });
      const r = applyAward(doc, input, i);
      doc = r.next;
      if (r.outcome === "recorded") {
        assert.ok(!seen.has(id), "recorded twice");
        seen.add(id);
      }
    }
    const total = walletTotal(doc);
    assert.ok(Number.isSafeInteger(total) && total >= 0 && total <= POINTS_CONFIG.caps.perWalletPerEpochTotal);
    assert.equal(new Set(doc.events.map((e) => e.eventId)).size, doc.events.length);
    assert.ok(doc.events.every((e) => Number.isSafeInteger(e.points) && e.points >= 0));
  }
});
