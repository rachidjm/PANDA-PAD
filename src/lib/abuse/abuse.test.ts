import { test } from "node:test";
import assert from "node:assert/strict";
import { ABUSE_CONFIG as C } from "./config";
import {
  collectSignals,
  detectClusterTrades,
  detectMarketCycles,
  detectNewWallets,
  detectPairConcentration,
  detectQuickFlips,
  detectRoundTrips,
  detectSharedFunder,
  detectSynchronized,
  detectUniformSizes,
  detectVelocity,
} from "./signals";
import { analyze, contribution, recommend, scoreWallet } from "./score";
import type { AnalysisInput, SaleRec, Signal, SignalFamily, TradeRec, WalletProfile } from "./types";

const MIN = 60_000;
const H = 3_600_000;
const D = 24 * H;
const SOL = 1_000_000_000;
const T0 = 1_800_000_000_000;

const sale = (asset: string, seller: string, buyer: string, price: number, ts: number): SaleRec => ({ asset, seller, buyer, priceLamports: price, ts });
const trade = (wallet: string, mint: string, side: "buy" | "sell", lamports: number, ts: number): TradeRec => ({ wallet, mint, side, lamports, ts });
const profile = (wallet: string, over: Partial<WalletProfile> = {}): WalletProfile => ({ wallet, firstSeenTs: T0 - 400 * D, reachedOrigin: false, funder: null, ...over });
const profiles = (...ps: WalletProfile[]) => new Map(ps.map((p) => [p.wallet, p]));
const has = (m: Map<string, Signal[]>, wallet: string, code?: string) => (m.get(wallet) ?? []).some((s) => !code || s.code === code);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ---- NFT market ------------------------------------------------------------------------------

test("cycles: an NFT that returns to a previous owner flags every wallet in the loop; loops outside the window or across assets don't", () => {
  const two = detectMarketCycles([sale("X", "A", "B", SOL, T0), sale("X", "B", "A", SOL, T0 + H)]);
  assert.ok(has(two, "A", "MARKET_CYCLE") && has(two, "B", "MARKET_CYCLE"));

  const three = detectMarketCycles([sale("X", "A", "B", SOL, T0), sale("X", "B", "C", SOL, T0 + H), sale("X", "C", "A", SOL, T0 + 2 * H)]);
  for (const w of ["A", "B", "C"]) assert.ok(has(three, w, "MARKET_CYCLE"), w);

  assert.equal(detectMarketCycles([sale("X", "A", "B", SOL, T0), sale("X", "B", "A", SOL, T0 + 30 * D)]).size, 0, "a buy-back a month later is not a wash");
  assert.equal(detectMarketCycles([sale("X", "A", "B", SOL, T0), sale("Y", "B", "A", SOL, T0 + H)]).size, 0, "different assets");
  assert.equal(detectMarketCycles([sale("X", "A", "B", SOL, T0), sale("X", "B", "C", SOL, T0 + H), sale("X", "C", "D", SOL, T0 + 2 * H)]).size, 0, "a chain of honest resales");
});

test("cycles: repetition raises points and confidence, within bounds", () => {
  const sales: SaleRec[] = [];
  for (let i = 0; i < 6; i++) sales.push(sale("X", i % 2 ? "B" : "A", i % 2 ? "A" : "B", SOL, T0 + i * H));
  const s = detectMarketCycles(sales).get("A")?.[0];
  assert.ok(s && s.points <= C.market.cyclePointsMax && s.confidence <= 90 && s.points > C.market.cyclePoints);
});

test("pair concentration: needs enough sales and one counterparty dominating; a creator selling to several fans is fine", () => {
  const mk = (n: number, to: (i: number) => string) => Array.from({ length: n }, (_, i) => sale(`N${i}`, "S", to(i), SOL, T0 + i * H));
  assert.ok(has(detectPairConcentration(mk(5, () => "B")), "S", "PAIR_CONCENTRATION"));
  assert.equal(detectPairConcentration(mk(3, () => "B")).size, 0, "too few sales");
  assert.equal(detectPairConcentration(mk(6, (i) => `Fan${i}`)).size, 0, "diversified");
  assert.equal(detectPairConcentration(mk(6, (i) => (i < 3 ? "B" : `Fan${i}`))).size, 0, "half with one buyer isn't dominance");
});

test("quick flips: needs repetition AND speed", () => {
  const flip = (asset: string, t: number, gap: number) => [sale(asset, "C", "F", SOL, t), sale(asset, "F", "G", SOL, t + gap)];
  assert.ok(has(detectQuickFlips([...flip("A1", T0, 5 * MIN), ...flip("A2", T0 + H, 3 * MIN)]), "F", "QUICK_FLIP"));
  assert.equal(detectQuickFlips(flip("A1", T0, 5 * MIN)).size, 0, "a single flip");
  assert.equal(detectQuickFlips([...flip("A1", T0, 2 * D), ...flip("A2", T0 + H, 3 * D)]).size, 0, "slow resales are ordinary trading");
});

test("cluster trades: buyer and seller with the same funder, or one funding the other, flag BOTH; unrelated wallets don't", () => {
  const sales = [sale("X", "S", "B", SOL, T0)];
  const same = detectClusterTrades(sales, profiles(profile("S", { funder: "F" }), profile("B", { funder: "F" })));
  assert.ok(has(same, "S", "CLUSTER_TRADE") && has(same, "B", "CLUSTER_TRADE"));
  assert.ok(has(detectClusterTrades(sales, profiles(profile("B", { funder: "S" }))), "B"), "the seller funded the buyer");
  assert.ok(has(detectClusterTrades(sales, profiles(profile("S", { funder: "B" }))), "S"), "the buyer funded the seller");
  assert.equal(detectClusterTrades(sales, profiles(profile("S", { funder: "F1" }), profile("B", { funder: "F2" }))).size, 0);
  assert.equal(detectClusterTrades(sales, profiles(profile("S"), profile("B"))).size, 0, "unknown funders prove nothing");
});

// ---- trading ------------------------------------------------------------------------------------

test("round trips: buying and selling the same coin within minutes at the same size is flagged; holding is not; tiny volume is not", () => {
  const churn: TradeRec[] = [];
  for (let i = 0; i < 6; i++) {
    churn.push(trade("W", "M", "buy", 1 * SOL, T0 + i * 20 * MIN));
    churn.push(trade("W", "M", "sell", 1.05 * SOL, T0 + i * 20 * MIN + 2 * MIN));
  }
  const s = detectRoundTrips(churn).get("W")?.[0];
  assert.ok(s && s.code === "ROUND_TRIPS" && s.family === "wash_trade" && s.points >= C.trade.roundTripPointsMin && s.points <= C.trade.roundTripPointsMax);

  const holder = [trade("H", "M", "buy", 2 * SOL, T0), trade("H", "M", "sell", 2.4 * SOL, T0 + 3 * D), trade("H", "N", "buy", 1 * SOL, T0 + H)];
  assert.equal(detectRoundTrips(holder).size, 0);

  const tiny = [trade("T", "M", "buy", 0.05 * SOL, T0), trade("T", "M", "sell", 0.05 * SOL, T0 + MIN)];
  assert.equal(detectRoundTrips(tiny).size, 0, "below the minimum volume");

  const slow = [trade("S", "M", "buy", 1 * SOL, T0), trade("S", "M", "sell", 1 * SOL, T0 + 2 * H)];
  assert.equal(detectRoundTrips([...slow, ...slow.map((t) => ({ ...t, ts: t.ts + D }))]).size, 0, "sells long after the buy");

  const diffSize = [trade("D", "M", "buy", 1 * SOL, T0), trade("D", "M", "sell", 3 * SOL, T0 + MIN)];
  assert.equal(detectRoundTrips(Array(4).fill(diffSize).flat().map((t, i) => ({ ...t, ts: t.ts + i * H }))).size, 0, "a 3x exit isn't a like-for-like round trip");
});

test("uniform sizes: many identical trades is only a weak signal, and needs many trades", () => {
  const same = Array.from({ length: 10 }, (_, i) => trade("U", `M${i}`, "buy", 0.1 * SOL, T0 + i * H));
  const s = detectUniformSizes(same).get("U")?.[0];
  assert.ok(s && s.confidence <= 40, "weak on purpose");
  assert.equal(detectUniformSizes(same.slice(0, 5)).size, 0);
  assert.equal(detectUniformSizes(same.map((t, i) => ({ ...t, lamports: (0.05 + i * 0.03) * SOL }))).size, 0);
});

// ---- Sybil ---------------------------------------------------------------------------------------

test("shared funder: a cluster of a suspicious size is flagged; too small, exchange-sized hubs and exempt funders are not", () => {
  const wallets = (n: number) => Array.from({ length: n }, (_, i) => `W${i}`);
  const funded = (n: number, funder = "F") => profiles(...wallets(n).map((w) => profile(w, { funder })));
  assert.equal(detectSharedFunder(wallets(6), funded(6), new Set()).size, 6);
  assert.equal(detectSharedFunder(wallets(4), funded(4), new Set()).size, 0, "4 friends funded by one person is ordinary");
  assert.equal(detectSharedFunder(wallets(40), funded(40), new Set()).size, 0, "an exchange or faucet funds thousands of unrelated people");
  assert.equal(detectSharedFunder(wallets(6), funded(6, "Treasury"), new Set(["Treasury"])).size, 0, "an exempt funder");
  const small = detectSharedFunder(wallets(5), funded(5), new Set()).get("W0")?.[0];
  const big = detectSharedFunder(wallets(20), funded(20), new Set()).get("W0")?.[0];
  assert.ok(small && big && big.confidence > small.confidence && big.confidence <= C.sybil.clusterConfidenceMax);
});

test("new wallets: only when we saw its real beginning and it is very young", () => {
  const end = T0;
  assert.ok(has(detectNewWallets(["N"], profiles(profile("N", { reachedOrigin: true, firstSeenTs: end - 1 * D })), end), "N", "NEW_WALLET"));
  assert.equal(detectNewWallets(["N"], profiles(profile("N", { reachedOrigin: false, firstSeenTs: end - 1 * D })), end).size, 0, "older history exists, we just didn't reach it");
  assert.equal(detectNewWallets(["N"], profiles(profile("N", { reachedOrigin: true, firstSeenTs: end - 30 * D })), end).size, 0);
  assert.equal(detectNewWallets(["N"], profiles(), end).size, 0, "no profile, no claim");
});

test("synchronized: a GROUP repeatedly first-trading the same coins in the same minute; one hot launch is not enough", () => {
  const group = Array.from({ length: 9 }, (_, i) => `G${i}`);
  const coins = (n: number) => group.flatMap((w, i) => Array.from({ length: n }, (_, c) => trade(w, `COIN${c}`, "buy", 0.2 * SOL, T0 + c * H + (i % 20) * 1000)));
  const flagged = detectSynchronized(coins(5));
  for (const w of group) assert.ok(has(flagged, w, "SYNCHRONIZED"), w);
  assert.equal(detectSynchronized(coins(1)).size, 0, "one hot launch");
  assert.equal(detectSynchronized(coins(3)).size, 0, "below the repetition needed");
  const staggered = group.flatMap((w, i) => Array.from({ length: 5 }, (_, c) => trade(w, `COIN${c}`, "buy", 0.2 * SOL, T0 + c * H + i * 5 * MIN)));
  assert.equal(detectSynchronized(staggered).size, 0, "spread over minutes is normal");
});

test("velocity: only near the per-wallet event cap", () => {
  assert.ok(has(detectVelocity([{ wallet: "V", events: 480 }], 500), "V", "EXTREME_FREQUENCY"));
  assert.equal(detectVelocity([{ wallet: "V", events: 100 }], 500).size, 0);
});

test("exempt wallets are never subjects, even when the evidence points at them", () => {
  const input: AnalysisInput = {
    epochStart: T0 - 7 * D,
    epochEnd: T0,
    wallets: [{ wallet: "Treasury", events: 495, points: 10 }],
    trades: [],
    sales: [sale("X", "Treasury", "B", SOL, T0), sale("X", "B", "Treasury", SOL, T0 + H)],
    profiles: new Map(),
    exempt: new Set(["Treasury"]),
  };
  assert.equal(collectSignals(input, 500).has("Treasury"), false);
  assert.equal(analyze(input, 500).some((f) => f.wallet === "Treasury"), false);
});

// ---- scoring: caution is the point ------------------------------------------------------------

const sig = (family: SignalFamily, points: number, confidence: number, code = "X"): Signal => ({ code, family, points, confidence, evidence: {} });

test("NO SINGLE FAMILY OF EVIDENCE CAN REACH RESTRICTED, however much of it there is", () => {
  const lots = Array.from({ length: 10 }, (_, i) => sig("wash_market", 400, 95, `S${i}`));
  const f = scoreWallet("W", lots);
  assert.equal(f.score, C.score.maxPerFamily);
  assert.equal(f.families.length, 1);
  assert.equal(f.recommended, "REVIEW");
  for (const family of ["wash_trade", "sybil", "velocity"] as const) {
    assert.equal(scoreWallet("W", Array.from({ length: 10 }, () => sig(family, 1000, 100))).recommended, "REVIEW", family);
  }
});

test("two independent families with real confidence are needed for RESTRICTED; a lot of both for DISQUALIFIED", () => {
  const restricted = scoreWallet("W", [sig("wash_market", 400, 90), sig("sybil", 250, 85)]);
  assert.equal(restricted.recommended, "RESTRICTED");
  assert.ok(restricted.families.length === 2 && restricted.confidence >= C.score.restrictedMinConfidence);

  const disq = scoreWallet("W", [sig("wash_market", 900, 95), sig("sybil", 900, 95), sig("wash_trade", 900, 95)]);
  assert.equal(disq.recommended, "DISQUALIFIED");

  const unsure = scoreWallet("W", [sig("wash_market", 900, 40), sig("sybil", 900, 40)]);
  assert.notEqual(unsure.recommended, "RESTRICTED", "two families but low confidence");
  assert.notEqual(unsure.recommended, "DISQUALIFIED");
});

test("weak evidence stays NORMAL: points are scaled by confidence, so guesses add little", () => {
  const weak = scoreWallet("W", [sig("wash_trade", 100, 40), sig("sybil", 60, 50), sig("velocity", 80, 50)]);
  assert.ok(weak.score < C.score.review);
  assert.equal(weak.recommended, "NORMAL");
  assert.equal(contribution(sig("sybil", 250, 65)), 162);
});

test("recommend() honours every threshold exactly", () => {
  assert.equal(recommend(199, 2, 100), "NORMAL");
  assert.equal(recommend(200, 1, 100), "REVIEW");
  assert.equal(recommend(500, 1, 100), "REVIEW", "one family");
  assert.equal(recommend(500, 2, 59), "REVIEW", "not confident enough");
  assert.equal(recommend(500, 2, 60), "RESTRICTED");
  assert.equal(recommend(800, 2, 69), "RESTRICTED");
  assert.equal(recommend(800, 2, 70), "DISQUALIFIED");
  assert.equal(recommend(1000, 1, 100), "REVIEW");
});

test("FUZZ: scores are integers in [0,1000]; adding evidence never lowers a score; one family never passes REVIEW", () => {
  const rand = rng(77);
  const families: SignalFamily[] = ["wash_market", "wash_trade", "sybil", "velocity"];
  for (let run = 0; run < 500; run++) {
    const signals: Signal[] = [];
    let prevScore = 0;
    for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) {
      signals.push(sig(families[Math.floor(rand() * 4)], Math.floor(rand() * 1001), Math.floor(rand() * 101), `S${i}`));
      const f = scoreWallet("W", signals);
      assert.ok(Number.isInteger(f.score) && f.score >= 0 && f.score <= 1000);
      assert.ok(Number.isInteger(f.confidence) && f.confidence >= 0 && f.confidence <= 100);
      assert.ok(f.score >= prevScore, "monotonic");
      if (f.families.length <= 1) assert.ok(f.recommended === "NORMAL" || f.recommended === "REVIEW");
      prevScore = f.score;
    }
    // Order doesn't matter.
    assert.equal(scoreWallet("W", signals).score, scoreWallet("W", [...signals].reverse()).score);
  }
});

// ---- end to end: who gets flagged, and who must not -------------------------------------------------

const base = (over: Partial<AnalysisInput>): AnalysisInput => ({ epochStart: T0 - 7 * D, epochEnd: T0, wallets: [], trades: [], sales: [], profiles: new Map(), exempt: new Set(), ...over });

test("A WASH FARM is caught: six wallets from one funder trading NFTs among themselves -> proposed RESTRICTED", () => {
  const farm = Array.from({ length: 6 }, (_, i) => `Farm${i}`);
  const sales: SaleRec[] = [];
  for (let round = 0; round < 3; round++) farm.forEach((w, i) => sales.push(sale(`N${i}`, w, farm[(i + 1) % 6], 1 * SOL, T0 - 5 * D + round * 6 * H + i * 20 * MIN)));
  // and each also loops the NFT back so it cycles
  farm.forEach((w, i) => sales.push(sale(`N${i}`, farm[(i + 1) % 6], w, 1 * SOL, T0 - 4 * D + i * 20 * MIN)));
  const findings = analyze(
    base({
      wallets: farm.map((wallet) => ({ wallet, events: 40, points: 300 })),
      sales,
      profiles: profiles(...farm.map((w) => profile(w, { funder: "Boss", reachedOrigin: true, firstSeenTs: T0 - 2 * D }))),
    }),
    500
  );
  assert.equal(findings.length, 6);
  for (const f of findings) {
    assert.equal(f.recommended, "RESTRICTED", f.wallet);
    assert.ok(f.reasonCodes.includes("SHARED_FUNDER") && f.reasonCodes.includes("CLUSTER_TRADE"));
    assert.ok(f.families.length >= 2);
  }
});

test("A COORDINATED PAIR (two related wallets wash-trading one NFT) is flagged for REVIEW only — one family is never enough to punish", () => {
  const findings = analyze(
    base({
      wallets: [{ wallet: "A", events: 10, points: 50 }, { wallet: "B", events: 10, points: 50 }],
      sales: [sale("X", "A", "B", SOL, T0 - D), sale("X", "B", "A", SOL, T0 - D + H), sale("X", "A", "B", SOL, T0 - D + 2 * H), sale("X", "B", "A", SOL, T0 - D + 3 * H)],
      profiles: profiles(profile("A", { funder: "F" }), profile("B", { funder: "F" })),
    }),
    500
  );
  assert.equal(findings.length, 2);
  for (const f of findings) assert.equal(f.recommended, "REVIEW");
});

test("HONEST ACTIVITY IS NOT FLAGGED: a busy trader, a creator selling to different fans, a hot-launch crowd, friends funded by one person", () => {
  const trader = Array.from({ length: 40 }, (_, i) => trade("Trader", `M${i % 12}`, i % 3 === 2 ? "sell" : "buy", (0.1 + ((i * 37) % 900) / 1000) * SOL, T0 - 6 * D + i * 4 * H));
  const fans = Array.from({ length: 8 }, (_, i) => sale(`N${i}`, "Creator", `Fan${i}`, (1 + i * 0.3) * SOL, T0 - 5 * D + i * 6 * H));
  const crowd = Array.from({ length: 12 }, (_, i) => trade(`Crowd${i}`, "HOTCOIN", "buy", 0.5 * SOL, T0 - 3 * D + i * 4000));
  const friends = ["F1", "F2", "F3"];
  const exchangeFunded = Array.from({ length: 200 }, (_, i) => `Ex${i}`);

  const findings = analyze(
    base({
      wallets: [
        { wallet: "Trader", events: 60, points: 400 },
        { wallet: "Creator", events: 10, points: 100 },
        ...crowd.map((t) => ({ wallet: t.wallet, events: 3, points: 20 })),
        ...friends.map((wallet) => ({ wallet, events: 5, points: 30 })),
        ...exchangeFunded.map((wallet) => ({ wallet, events: 2, points: 10 })),
      ],
      trades: [...trader, ...crowd],
      sales: fans,
      profiles: profiles(
        profile("Trader", { funder: "Exchange" }),
        ...friends.map((w) => profile(w, { funder: "Alice", reachedOrigin: true, firstSeenTs: T0 - 200 * D })),
        ...exchangeFunded.map((w) => profile(w, { funder: "BigExchange" }))
      ),
    }),
    500
  );
  assert.deepEqual(findings.map((f) => f.wallet), [], `unexpected flags: ${JSON.stringify(findings.map((f) => [f.wallet, f.reasonCodes]))}`);
});

test("findings are deterministic and sorted riskiest-first", () => {
  const input = base({
    wallets: [{ wallet: "A", events: 480, points: 1 }, { wallet: "B", events: 10, points: 1 }],
    sales: [sale("X", "A", "B", SOL, T0 - H), sale("X", "B", "A", SOL, T0)],
    profiles: profiles(profile("A", { funder: "F" }), profile("B", { funder: "F" })),
  });
  const a = analyze(input, 500);
  assert.deepEqual(a, analyze(input, 500));
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].score >= a[i].score);
});
