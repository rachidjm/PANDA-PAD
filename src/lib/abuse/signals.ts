import { ABUSE_CONFIG as C } from "./config";
import type { AnalysisInput, SaleRec, Signal, TradeRec, WalletProfile } from "./types";

/**
 * The detectors. Each one is a pure function over plain data that returns
 * signals per wallet — no I/O, no clock, nothing random — so every rule can be
 * tested with hand-built scenarios, including the ones that must NOT flag an
 * honest user. A signal is evidence, not a verdict: see score.ts for how
 * evidence becomes a (deliberately cautious) proposal.
 */

type SignalMap = Map<string, Signal[]>;

function add(map: SignalMap, wallet: string, signal: Signal) {
  const list = map.get(wallet);
  if (list) list.push(signal);
  else map.set(wallet, [signal]);
}

const bySale = (a: SaleRec, b: SaleRec) => a.ts - b.ts;
const byTrade = (a: TradeRec, b: TradeRec) => a.ts - b.ts;

// ---- NFT market: wash trading ---------------------------------------------------------------------

/** An NFT that comes back to one of its previous owners (A -> B -> A, or A -> B -> C -> A) within the window. */
export function detectMarketCycles(sales: SaleRec[]): SignalMap {
  const out: SignalMap = new Map();
  const cycles = new Map<string, number>();
  const byAsset = new Map<string, SaleRec[]>();
  for (const s of sales) byAsset.set(s.asset, [...(byAsset.get(s.asset) ?? []), s]);

  for (const list of byAsset.values()) {
    const ordered = [...list].sort(bySale);
    // Who held it, and since when. The first seller is treated as holding it from their first sale.
    const history: { wallet: string; since: number }[] = [{ wallet: ordered[0].seller, since: ordered[0].ts }];
    for (const sale of ordered) {
      const prior = history.findIndex((h) => h.wallet === sale.buyer);
      if (prior !== -1 && sale.ts - history[prior].since <= C.market.cycleWindowMs) {
        for (const h of history.slice(prior)) cycles.set(h.wallet, (cycles.get(h.wallet) ?? 0) + 1);
      }
      history.push({ wallet: sale.buyer, since: sale.ts });
    }
  }

  for (const [wallet, count] of cycles) {
    add(out, wallet, {
      code: "MARKET_CYCLE",
      family: "wash_market",
      points: Math.min(C.market.cyclePointsMax, C.market.cyclePoints * count),
      confidence: Math.min(90, 60 + 10 * count),
      evidence: { cycles: count },
    });
  }
  return out;
}

/** Most of a wallet's NFT trading volume is with one single counterparty. */
export function detectPairConcentration(sales: SaleRec[]): SignalMap {
  const out: SignalMap = new Map();
  const perWallet = new Map<string, { count: number; total: number; with: Map<string, number> }>();
  const touch = (wallet: string, other: string, price: number) => {
    const e = perWallet.get(wallet) ?? { count: 0, total: 0, with: new Map<string, number>() };
    e.count++;
    e.total += price;
    e.with.set(other, (e.with.get(other) ?? 0) + price);
    perWallet.set(wallet, e);
  };
  for (const s of sales) {
    touch(s.buyer, s.seller, s.priceLamports);
    touch(s.seller, s.buyer, s.priceLamports);
  }
  for (const [wallet, e] of perWallet) {
    if (e.count < C.market.pairMinSales || e.total <= 0) continue;
    const top = Math.max(...e.with.values());
    const shareBps = Math.floor((top * 10_000) / e.total);
    if (shareBps >= C.market.pairShareBps) {
      add(out, wallet, { code: "PAIR_CONCENTRATION", family: "wash_market", points: C.market.pairPoints, confidence: C.market.pairConfidence, evidence: { sales: e.count, topCounterpartyShareBps: shareBps } });
    }
  }
  return out;
}

/** Buys an NFT and resells it within minutes, repeatedly. */
export function detectQuickFlips(sales: SaleRec[]): SignalMap {
  const out: SignalMap = new Map();
  const boughtAt = new Map<string, number>(); // `${wallet}|${asset}` -> time it bought
  const flips = new Map<string, number>();
  for (const s of [...sales].sort(bySale)) {
    const held = boughtAt.get(`${s.seller}|${s.asset}`);
    if (held !== undefined && s.ts - held <= C.market.flipWindowMs) flips.set(s.seller, (flips.get(s.seller) ?? 0) + 1);
    boughtAt.set(`${s.buyer}|${s.asset}`, s.ts);
  }
  for (const [wallet, count] of flips) {
    if (count >= C.market.flipMinCount) {
      add(out, wallet, { code: "QUICK_FLIP", family: "wash_market", points: C.market.flipPoints, confidence: C.market.flipConfidence, evidence: { flips: count } });
    }
  }
  return out;
}

/** The buyer and the seller are provably related: same first funder, or one funded the other. The strongest market signal. */
export function detectClusterTrades(sales: SaleRec[], profiles: Map<string, WalletProfile>): SignalMap {
  const out: SignalMap = new Map();
  const counts = new Map<string, number>();
  for (const s of sales) {
    const bf = profiles.get(s.buyer)?.funder ?? null;
    const sf = profiles.get(s.seller)?.funder ?? null;
    const related = (bf !== null && bf === sf) || bf === s.seller || sf === s.buyer;
    if (!related) continue;
    counts.set(s.buyer, (counts.get(s.buyer) ?? 0) + 1);
    counts.set(s.seller, (counts.get(s.seller) ?? 0) + 1);
  }
  for (const [wallet, count] of counts) {
    add(out, wallet, { code: "CLUSTER_TRADE", family: "wash_market", points: C.market.clusterPoints, confidence: C.market.clusterConfidence, evidence: { relatedSales: count } });
  }
  return out;
}

// ---- bonding-curve trading -----------------------------------------------------------------------------

/** Buys and sells the same coin within minutes, in about the same size: volume that goes nowhere. */
export function detectRoundTrips(trades: TradeRec[]): SignalMap {
  const out: SignalMap = new Map();
  const perWallet = new Map<string, TradeRec[]>();
  for (const t of trades) perWallet.set(t.wallet, [...(perWallet.get(t.wallet) ?? []), t]);

  for (const [wallet, all] of perWallet) {
    const total = all.reduce((sum, t) => sum + t.lamports, 0);
    if (total <= 0) continue;
    let matched = 0;
    const byMint = new Map<string, TradeRec[]>();
    for (const t of all) byMint.set(t.mint, [...(byMint.get(t.mint) ?? []), t]);
    for (const list of byMint.values()) {
      const ordered = [...list].sort(byTrade);
      const usedSells = new Set<number>();
      ordered.forEach((buy, i) => {
        if (buy.side !== "buy") return;
        for (let j = i + 1; j < ordered.length; j++) {
          const sell = ordered[j];
          if (sell.side !== "sell" || usedSells.has(j)) continue;
          if (sell.ts - buy.ts > C.trade.roundTripWindowMs) break;
          const diffBps = Math.floor((Math.abs(sell.lamports - buy.lamports) * 10_000) / buy.lamports);
          if (diffBps <= C.trade.roundTripSizeToleranceBps) {
            usedSells.add(j);
            matched += buy.lamports + sell.lamports;
            break;
          }
        }
      });
    }
    const shareBps = Math.floor((matched * 10_000) / total);
    if (shareBps >= C.trade.roundTripMinShareBps && matched >= C.trade.roundTripMinLamports) {
      const span = C.trade.roundTripPointsMax - C.trade.roundTripPointsMin;
      const points = C.trade.roundTripPointsMin + Math.floor((span * (shareBps - C.trade.roundTripMinShareBps)) / (10_000 - C.trade.roundTripMinShareBps));
      add(out, wallet, { code: "ROUND_TRIPS", family: "wash_trade", points, confidence: C.trade.roundTripConfidence, evidence: { roundTripShareBps: shareBps } });
    }
  }
  return out;
}

/** Nearly all of a wallet's trades are exactly the same size. Weak: plenty of honest people always buy the same amount. */
export function detectUniformSizes(trades: TradeRec[]): SignalMap {
  const out: SignalMap = new Map();
  const perWallet = new Map<string, number[]>();
  for (const t of trades) perWallet.set(t.wallet, [...(perWallet.get(t.wallet) ?? []), Math.round(t.lamports / C.trade.uniformBucketLamports)]);
  for (const [wallet, buckets] of perWallet) {
    if (buckets.length < C.trade.uniformMinTrades) continue;
    const counts = new Map<number, number>();
    for (const b of buckets) counts.set(b, (counts.get(b) ?? 0) + 1);
    const shareBps = Math.floor((Math.max(...counts.values()) * 10_000) / buckets.length);
    if (shareBps >= C.trade.uniformShareBps) {
      add(out, wallet, { code: "UNIFORM_SIZES", family: "wash_trade", points: C.trade.uniformPoints, confidence: C.trade.uniformConfidence, evidence: { trades: buckets.length, sameSizeShareBps: shareBps } });
    }
  }
  return out;
}

// ---- Sybil ----------------------------------------------------------------------------------------------

/** Several analysed wallets were all first funded by the same address (not an exchange-sized hub). */
export function detectSharedFunder(walletList: string[], profiles: Map<string, WalletProfile>, exempt: Set<string>): SignalMap {
  const out: SignalMap = new Map();
  const groups = new Map<string, string[]>();
  for (const w of walletList) {
    const funder = profiles.get(w)?.funder;
    if (!funder || exempt.has(funder)) continue;
    groups.set(funder, [...(groups.get(funder) ?? []), w]);
  }
  for (const [funder, members] of groups) {
    if (members.length < C.sybil.minCluster || members.length > C.sybil.hubSize) continue; // too small = ordinary; too big = an exchange or faucet
    const confidence = Math.min(C.sybil.clusterConfidenceMax, C.sybil.clusterConfidenceBase + 3 * (members.length - C.sybil.minCluster));
    for (const wallet of members) {
      add(out, wallet, { code: "SHARED_FUNDER", family: "sybil", points: C.sybil.clusterPoints, confidence, evidence: { clusterSize: members.length, funder } });
    }
  }
  return out;
}

/** The wallet came into existence just before the epoch ended (only when we saw its real beginning). Weak on purpose. */
export function detectNewWallets(walletList: string[], profiles: Map<string, WalletProfile>, epochEnd: number): SignalMap {
  const out: SignalMap = new Map();
  for (const w of walletList) {
    const p = profiles.get(w);
    if (p && p.reachedOrigin && p.firstSeenTs !== null && epochEnd - p.firstSeenTs < C.sybil.newWalletMs) {
      add(out, w, { code: "NEW_WALLET", family: "sybil", points: C.sybil.newWalletPoints, confidence: C.sybil.newWalletConfidence, evidence: { ageHours: Math.floor(Math.max(0, epochEnd - p.firstSeenTs) / 3_600_000) } });
    }
  }
  return out;
}

/** A group that keeps making its first trade of the same coins inside the same minute. */
export function detectSynchronized(trades: TradeRec[]): SignalMap {
  const out: SignalMap = new Map();
  const first = new Map<string, TradeRec>(); // `${wallet}|${mint}` -> first trade
  for (const t of [...trades].sort(byTrade)) {
    const key = `${t.wallet}|${t.mint}`;
    if (!first.has(key)) first.set(key, t);
  }
  const buckets = new Map<string, Set<string>>();
  for (const t of first.values()) {
    const key = `${t.mint}|${Math.floor(t.ts / C.sybil.syncBucketMs)}`;
    buckets.set(key, (buckets.get(key) ?? new Set()).add(t.wallet));
  }
  const crowded = [...buckets.values()].filter((members) => members.size >= C.sybil.syncMinWallets);

  const together = new Map<string, Map<string, number>>(); // wallet -> other wallet -> crowded buckets shared
  for (const members of crowded) {
    for (const a of members) {
      const row = together.get(a) ?? new Map<string, number>();
      for (const b of members) if (a !== b) row.set(b, (row.get(b) ?? 0) + 1);
      together.set(a, row);
    }
  }
  for (const [wallet, row] of together) {
    const companions = [...row.values()].filter((n) => n >= C.sybil.syncMinCoins).length;
    if (companions >= C.sybil.syncMinWallets - 1) {
      add(out, wallet, { code: "SYNCHRONIZED", family: "sybil", points: C.sybil.syncPoints, confidence: C.sybil.syncConfidence, evidence: { companions } });
    }
  }
  return out;
}

// ---- velocity ---------------------------------------------------------------------------------------------

export function detectVelocity(wallets: { wallet: string; events: number }[], eventCap: number): SignalMap {
  const out: SignalMap = new Map();
  for (const w of wallets) {
    if (w.events * 10_000 >= eventCap * C.velocity.capShareBps) {
      add(out, w.wallet, { code: "EXTREME_FREQUENCY", family: "velocity", points: C.velocity.points, confidence: C.velocity.confidence, evidence: { events: w.events, cap: eventCap } });
    }
  }
  return out;
}

// ---- everything together ----------------------------------------------------------------------------------

/** Runs every detector. Wallets in `exempt` are never subjects (PANDA's own wallets, admins, known infrastructure). */
export function collectSignals(input: AnalysisInput, eventCap: number): Map<string, Signal[]> {
  const merged: SignalMap = new Map();
  const walletList = input.wallets.map((w) => w.wallet);
  const merge = (m: SignalMap) => {
    for (const [wallet, list] of m) for (const s of list) add(merged, wallet, s);
  };

  merge(detectMarketCycles(input.sales));
  merge(detectPairConcentration(input.sales));
  merge(detectQuickFlips(input.sales));
  merge(detectClusterTrades(input.sales, input.profiles));
  merge(detectRoundTrips(input.trades));
  merge(detectUniformSizes(input.trades));
  merge(detectSharedFunder(walletList, input.profiles, input.exempt));
  merge(detectNewWallets(walletList, input.profiles, input.epochEnd));
  merge(detectSynchronized(input.trades));
  merge(detectVelocity(input.wallets, eventCap));

  for (const wallet of input.exempt) merged.delete(wallet);
  return merged;
}
