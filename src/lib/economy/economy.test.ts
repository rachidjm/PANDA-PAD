import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { addMetrics, addTo, cleanDelta, emptyMetrics, readDays, readTotal } from "./rollup";
import { breakdown, distributionShares } from "./shares";
import { airdropsSection, buildEconomy, creatorFeesSection, EconomyDeps, feesSection, nftSection, rewardsSection, volumeSection } from "./snapshot";
import { formatSolAmount, formatTokenUnits } from "./format";
import { recordActivity } from "@/lib/activity/record";
import { appendEvent } from "@/lib/activity/journal";
import { ACTIVITY_CONFIG } from "@/lib/activity/config";

const SOL = 1_000_000_000;
const D = 24 * 3_600_000;
const addr = () => Keypair.generate().publicKey.toBase58();
const sigOf = () => Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58().slice(0, 30);

// ---- rollup -----------------------------------------------------------------------------------------

test("a delta is only accepted if it is known keys and non-negative safe integers", () => {
  assert.deepEqual(cleanDelta({ volumeLamports: 5, trades: 1 }), { volumeLamports: 5, trades: 1 });
  for (const bad of [{ volumeLamports: -1 }, { volumeLamports: 1.5 }, { volumeLamports: NaN }, { volumeLamports: Number.MAX_SAFE_INTEGER + 2 }, { nope: 1 } as never]) {
    assert.equal(cleanDelta(bad), null, JSON.stringify(bad));
  }
});

test("addTo adds per metric and refuses to overflow", () => {
  const m = addTo(addTo(emptyMetrics(), { volumeLamports: 10, trades: 1 }), { volumeLamports: 5 });
  assert.equal(m.volumeLamports, 15);
  assert.equal(m.trades, 1);
  assert.equal(m.tradeFeeLamports, 0, "untouched metrics stay 0");
  assert.throws(() => addTo({ ...emptyMetrics(), volumeLamports: Number.MAX_SAFE_INTEGER }, { volumeLamports: 1 }), RangeError);
});

test("addMetrics updates the day and the all-time totals; days are zero-filled; 'since' is the earliest", async () => {
  const t0 = Date.now() + 200 * D; // days nothing else touches
  assert.equal(await addMetrics(t0, { volumeLamports: 2 * SOL, trades: 1 }), true);
  assert.equal(await addMetrics(t0 - 2 * D, { volumeLamports: 1 * SOL, trades: 1 }), true);
  assert.equal(await addMetrics(t0, { volumeLamports: 3 * SOL, trades: 2 }), true);
  assert.equal(await addMetrics(t0, { volumeLamports: -1 }), false, "malformed delta refused");
  assert.equal(await addMetrics(0, { trades: 1 }), false);

  const days = await readDays(t0, 3);
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((d) => d.metrics.volumeLamports), [1 * SOL, 0, 5 * SOL], "oldest first, empty day is zero");
  const total = await readTotal();
  assert.ok(total.metrics.volumeLamports >= 6 * SOL && total.metrics.trades >= 4);
  assert.ok(total.since !== null && total.since <= t0 - 2 * D);
});

// ---- recording: counted once, and honest when the journal is full ---------------------------------------

test("recordActivity counts an event's metrics once — repeating the same transaction changes nothing", async () => {
  const before = (await readTotal()).metrics;
  const sig = sigOf();
  const ev = { id: `trade:${sig}`, kind: "buy" as const, ts: Date.now() - 1000, mint: addr(), wallet: addr(), lamports: 2 * SOL, signature: sig };
  const delta = { trades: 1, volumeLamports: 2 * SOL, tradeFeeLamports: SOL / 50 };
  await recordActivity(ev, delta);
  await recordActivity(ev, delta);
  await recordActivity(ev, delta);
  const after = (await readTotal()).metrics;
  assert.equal(after.trades - before.trades, 1);
  assert.equal(after.volumeLamports - before.volumeLamports, 2 * SOL);
  assert.equal(after.tradeFeeLamports - before.tradeFeeLamports, SOL / 50);
});

test("an invalid event contributes nothing; a full journal counts the event as dropped instead of losing it silently", async () => {
  const before = (await readTotal()).metrics;
  await recordActivity({ id: "bad id", kind: "buy", ts: Date.now(), mint: addr(), lamports: 1 }, { trades: 1 });
  assert.equal((await readTotal()).metrics.trades, before.trades);

  const now = Date.now();
  for (let i = 0; i < ACTIVITY_CONFIG.journalDayCap; i++) await appendEvent({ id: `trade:fill-${i}-xxxxxx`, kind: "buy", ts: now - 1000, mint: addr(), lamports: 1 }, now);
  const mid = (await readTotal()).metrics;
  await recordActivity({ id: `trade:${sigOf()}`, kind: "buy", ts: now - 500, mint: addr(), lamports: SOL }, { trades: 1, volumeLamports: SOL });
  const after = (await readTotal()).metrics;
  assert.equal(after.dropped - mid.dropped, 1);
  assert.equal(after.trades, mid.trades, "not counted as a trade — only flagged as dropped");
});

// ---- fee splits ------------------------------------------------------------------------------------------

test("a distribution's real split comes from balance changes; the payer's share has the network fee added back", () => {
  const [pool, treasury, creator, outsider] = [addr(), addr(), addr(), addr()];
  const view = { keys: [pool, treasury, creator, outsider], pre: [10 * SOL, 1 * SOL, 2 * SOL, 5 * SOL], post: [10.3 * SOL - 5000, 1.05 * SOL, 2.65 * SOL, 5 * SOL], fee: 5000, feePayer: pool };
  const shares = distributionShares(view, [pool, treasury, creator]);
  const by = Object.fromEntries(shares.map((s) => [s.address, s.lamports]));
  assert.equal(by[pool], Math.round(0.3 * SOL), "payer: raw change + fee");
  assert.equal(by[treasury], Math.round(0.05 * SOL));
  assert.equal(by[creator], Math.round(0.65 * SOL));
  assert.equal(by[outsider], undefined, "only configured shareholders are counted");

  const b = breakdown(shares, treasury, pool);
  assert.equal(b.total, by[pool] + by[treasury] + by[creator]);
  assert.equal(b.treasury + b.pool + b.others, b.total, "the parts always add up to the whole");
  assert.equal(b.others, by[creator]);
});

test("shares: unknown accounts count as 0, negatives are clamped, duplicates counted once", () => {
  const a = addr();
  const shares = distributionShares({ keys: [a], pre: [5], post: [3], fee: 0, feePayer: "x" }, [a, a, addr()]);
  assert.equal(shares.length, 2);
  assert.ok(shares.every((s) => s.lamports === 0));
  const same = addr();
  assert.equal(breakdown([{ address: same, lamports: 10 }], same, same).pool, 0, "treasury == pool is not counted twice");
});

// ---- sections -----------------------------------------------------------------------------------------------

const metricsWith = (o: Partial<ReturnType<typeof emptyMetrics>>) => ({ ...emptyMetrics(), ...o });

test("volume: totals, last 7 days and a 14-day series; incomplete when events were dropped", () => {
  const days = Array.from({ length: 20 }, (_, i) => ({ day: `2026-01-${String(i + 1).padStart(2, "0")}`, metrics: metricsWith({ volumeLamports: (i + 1) * SOL }) }));
  const v = volumeSection({ since: 123, metrics: metricsWith({ volumeLamports: 500 * SOL, trades: 42 }) }, days);
  assert.equal(v.days.length, 14);
  assert.equal(v.days[13].lamports, 20 * SOL, "newest last");
  assert.equal(v.last7dLamports, (14 + 15 + 16 + 17 + 18 + 19 + 20) * SOL);
  assert.equal(v.totalLamports, 500 * SOL);
  assert.equal(v.incomplete, false);
  assert.equal(volumeSection({ since: 1, metrics: metricsWith({ dropped: 1 }) }, []).incomplete, true);
});

test("fees stay in separate fields; creator fees split into treasury, pool and others without losing a lamport", () => {
  const total = { since: 1, metrics: metricsWith({ tradeFeeLamports: 7, creatorFeeLamports: 100, creatorFeeTreasuryLamports: 5, creatorFeePoolLamports: 30, distributions: 3 }) };
  assert.deepEqual([feesSection(total).tradeFeeLamports, feesSection(total).creatorFeeShareLamports], [7, 5]);
  const c = creatorFeesSection(total);
  assert.equal(c.toOthersLamports, 65);
  assert.equal(c.toTreasuryLamports + c.toRewardsPoolLamports + c.toOthersLamports, c.totalLamports);
  assert.equal(creatorFeesSection({ since: 1, metrics: metricsWith({ creatorFeeLamports: 1, creatorFeePoolLamports: 5 }) }).toOthersLamports, 0, "never negative");
});

test("rewards: credited excludes dust; claimed and claimable are summed from every holder", () => {
  const r = rewardsSection(
    [
      { totalDistributedLamports: 1000, dustLamports: 3, holders: { a: { entitledLamports: 600, claimedLamports: 200 }, b: { entitledLamports: 397, claimedLamports: 397 } } },
      { totalDistributedLamports: 50, holders: { a: { entitledLamports: 50, claimedLamports: 0 } } },
    ],
    false
  );
  assert.deepEqual(r, { coins: 2, creditedLamports: 1047, claimedLamports: 597, claimableLamports: 450, dustLamports: 3, partial: false });
  assert.equal(r.creditedLamports, 600 + 397 + 50, "credited = what holders are entitled to");
});

test("airdrops: exact in big integers (beyond 2^53), sorted, in token units apart from SOL", () => {
  const big = "900000000000000000000";
  const a = airdropsSection([{ epoch: 2, distributed: big, claimed: "1", claimedCount: 1, leaves: 5 }, { epoch: 1, distributed: "5", claimed: "5", claimedCount: 1, leaves: 1 }], 6, true, [3]);
  assert.deepEqual(a.epochs.map((e) => e.epoch), [1, 2]);
  assert.equal(a.totalDistributed, "900000000000000000005");
  assert.equal(a.totalClaimed, "6");
  assert.deepEqual([a.decimals, a.partial, a.unverifiedEpochs], [6, true, [3]]);
});

test("NFT: primary and secondary volume are separate; only completed sales count", () => {
  const sale = (kind: "primary" | "secondary", price: number, status = "COMPLETED") => ({ kind, priceLamports: price, feeLamports: price / 50, royaltyLamports: kind === "secondary" ? price / 20 : 0, status });
  const n = nftSection([sale("primary", 1 * SOL), sale("primary", 2 * SOL), sale("secondary", 10 * SOL), sale("secondary", 99 * SOL, "PENDING")]);
  assert.deepEqual(n.primary, { sales: 2, volumeLamports: 3 * SOL });
  assert.deepEqual(n.secondary, { sales: 1, volumeLamports: 10 * SOL });
  assert.equal(n.marketFeesLamports, (1 + 2 + 10) * SOL / 50);
  assert.equal(n.royaltiesLamports, 10 * SOL / 20);
});

// ---- assembly ---------------------------------------------------------------------------------------------------

const okDeps = (over: Partial<EconomyDeps> = {}): EconomyDeps => ({
  now: () => 1_800_000_000_000,
  total: async () => ({ since: 1, metrics: metricsWith({ volumeLamports: SOL }) }),
  days: async () => [],
  ledgers: async () => ({ ledgers: [], partial: false }),
  airdrops: async () => ({ epochs: [], partial: false, unverified: [], decimals: null }),
  sales: async () => [],
  ...over,
});

test("buildEconomy: a section that can't be read is null and reported unavailable — never a zero", async () => {
  const boom = async () => {
    throw new Error("storage down");
  };
  const s = await buildEconomy(okDeps({ ledgers: boom, sales: boom }));
  assert.equal(s.rewards, null);
  assert.equal(s.nft, null);
  assert.deepEqual(s.status, { pandaMetrics: "ok", rewards: "unavailable", airdrops: "ok", nft: "unavailable" });
  assert.equal(s.volume?.totalLamports, SOL);

  const none = await buildEconomy(okDeps({ total: boom, days: boom, ledgers: boom, airdrops: boom, sales: boom }));
  assert.equal(none.volume, null);
  assert.equal(none.fees, null);
  assert.equal(none.creatorFees, null);
  assert.ok(Object.values(none.status).every((x) => x === "unavailable"));

  const noDays = await buildEconomy(okDeps({ days: boom }));
  assert.equal(noDays.volume?.days.length, 0, "the totals still show without the daily series");
});

// ---- display -------------------------------------------------------------------------------------------------

test("SOL text never rounds a real amount down to zero and adapts precision", () => {
  assert.equal(formatSolAmount(0, "en"), "0");
  assert.equal(formatSolAmount(1, "en"), "<0.0001");
  assert.equal(formatSolAmount(1, "es"), "<0,0001");
  assert.equal(formatSolAmount(1_500_000_000, "en"), "1.5");
  assert.equal(formatSolAmount(12_345_678_901, "en"), "12.35");
  assert.equal(formatSolAmount(1_234_567 * 1_000_000_000, "en"), "1,234,567");
});

test("token units are exact past 2^53, with decimals or without", () => {
  assert.equal(formatTokenUnits("5000000000000", 6, "en"), "5,000,000");
  assert.equal(formatTokenUnits("1234567", 6, "en"), "1.23");
  assert.equal(formatTokenUnits("1234567", 6, "es"), "1,23");
  assert.equal(formatTokenUnits("900000000000000000005", 6, "en"), "900,000,000,000,000");
  assert.equal(formatTokenUnits("42", null, "en"), "42", "unknown decimals: raw units, never a guess");
  assert.equal(formatTokenUnits("not a number", 6, "en"), "—");
});

test("token amounts can be shown in full precision, truncated (never rounded up), with trailing zeros dropped", () => {
  assert.equal(formatTokenUnits("4999999999998", 6, "en", 6), "4,999,999.999998", "not 4,999,999.99");
  assert.equal(formatTokenUnits("4999999999998", 6, "en"), "4,999,999.99", "the default still shows two decimals, truncated");
  assert.equal(formatTokenUnits("2", 6, "en", 6), "0.000002", "a tiny remainder is not shown as 0");
  assert.equal(formatTokenUnits("2", 6, "en"), "0", "…unless only two decimals were asked for");
  assert.equal(formatTokenUnits("5000000000000", 6, "en", 6), "5,000,000", "zeros dropped");
  assert.equal(formatTokenUnits("1500000", 6, "es", 6), "1,5");
  assert.equal(formatTokenUnits("123456789", 9, "en", 20), "0.123456789", "asking for more digits than the token has is fine");
  assert.equal(formatTokenUnits("1234567", 6, "en", 0), "1", "zero decimals truncates");
});
