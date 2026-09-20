import type { Metrics } from "./rollup";

/**
 * The PANDA economy, one section per kind of money and never added together: SOL volume PANDA measured, PANDA's
 * fees, creator fees, holder rewards (SOL ledgers), airdrops (PANDA token units, not SOL) and NFT sales. Every
 * section carries where its numbers come from, and a section that couldn't be read is `null` — not zero.
 */

export type VolumeSection = {
  since: number | null;
  totalLamports: number;
  trades: number;
  last7dLamports: number;
  /** Last 14 days, oldest first. */
  days: { day: string; lamports: number }[];
  /** True when some events couldn't be counted, so these are lower bounds. */
  incomplete: boolean;
};

export type FeesSection = {
  since: number | null;
  /** PANDA's 1% trade fee, from transactions PANDA verified. */
  tradeFeeLamports: number;
  /** PANDA's share of creator fees, from the payouts of verified fee distributions. */
  creatorFeeShareLamports: number;
  incomplete: boolean;
};

export type CreatorFeesSection = {
  since: number | null;
  distributions: number;
  totalLamports: number;
  toTreasuryLamports: number;
  toRewardsPoolLamports: number;
  toOthersLamports: number;
  incomplete: boolean;
};

export type RewardsSection = {
  coins: number;
  /** Credited to holders' ledgers. */
  creditedLamports: number;
  /** Booked as claimed by holders. */
  claimedLamports: number;
  claimableLamports: number;
  /** Rounding remainder held by the pool that no holder was credited. */
  dustLamports: number;
  partial: boolean;
};

export type AirdropEpoch = { epoch: number; distributed: string; claimed: string; claimedCount: number; leaves: number };
export type AirdropsSection = {
  /** PANDA token base units (decimal strings, may exceed 2^53) — NOT SOL. */
  epochs: AirdropEpoch[];
  totalDistributed: string;
  totalClaimed: string;
  decimals: number | null;
  /** True when some claim records weren't read. */
  partial: boolean;
  /** Epochs whose published data failed its integrity check and were left out. */
  unverifiedEpochs: number[];
};

export type NftKindTotals = { sales: number; volumeLamports: number };
export type NftSection = {
  primary: NftKindTotals;
  secondary: NftKindTotals;
  marketFeesLamports: number;
  royaltiesLamports: number;
};

export type SectionStatus = "ok" | "unavailable";
export type EconomySnapshot = {
  generatedAt: number;
  volume: VolumeSection | null;
  fees: FeesSection | null;
  creatorFees: CreatorFeesSection | null;
  rewards: RewardsSection | null;
  airdrops: AirdropsSection | null;
  nft: NftSection | null;
  status: Record<"pandaMetrics" | "rewards" | "airdrops" | "nft", SectionStatus>;
};

// ---- pure builders -------------------------------------------------------------------------------

export function volumeSection(total: { since: number | null; metrics: Metrics }, days: { day: string; metrics: Metrics }[]): VolumeSection {
  const last7 = days.slice(-7).reduce((s, d) => s + d.metrics.volumeLamports, 0);
  return {
    since: total.since,
    totalLamports: total.metrics.volumeLamports,
    trades: total.metrics.trades,
    last7dLamports: last7,
    days: days.slice(-14).map((d) => ({ day: d.day, lamports: d.metrics.volumeLamports })),
    incomplete: total.metrics.dropped > 0,
  };
}

export function feesSection(total: { since: number | null; metrics: Metrics }): FeesSection {
  return {
    since: total.since,
    tradeFeeLamports: total.metrics.tradeFeeLamports,
    creatorFeeShareLamports: total.metrics.creatorFeeTreasuryLamports,
    incomplete: total.metrics.dropped > 0,
  };
}

export function creatorFeesSection(total: { since: number | null; metrics: Metrics }): CreatorFeesSection {
  const m = total.metrics;
  return {
    since: total.since,
    distributions: m.distributions,
    totalLamports: m.creatorFeeLamports,
    toTreasuryLamports: m.creatorFeeTreasuryLamports,
    toRewardsPoolLamports: m.creatorFeePoolLamports,
    toOthersLamports: Math.max(0, m.creatorFeeLamports - m.creatorFeeTreasuryLamports - m.creatorFeePoolLamports),
    incomplete: m.dropped > 0,
  };
}

type LedgerLike = { totalDistributedLamports: number; dustLamports?: number; holders: Record<string, { entitledLamports: number; claimedLamports: number }> };

export function rewardsSection(ledgers: LedgerLike[], partial: boolean): RewardsSection {
  let credited = 0;
  let claimed = 0;
  let claimable = 0;
  let dust = 0;
  for (const l of ledgers) {
    credited += l.totalDistributedLamports - (l.dustLamports ?? 0);
    dust += l.dustLamports ?? 0;
    for (const h of Object.values(l.holders)) {
      claimed += h.claimedLamports;
      claimable += Math.max(0, h.entitledLamports - h.claimedLamports);
    }
  }
  return { coins: ledgers.length, creditedLamports: credited, claimedLamports: claimed, claimableLamports: claimable, dustLamports: dust, partial };
}

export function airdropsSection(epochs: AirdropEpoch[], decimals: number | null, partial: boolean, unverified: number[]): AirdropsSection {
  const sorted = [...epochs].sort((a, b) => a.epoch - b.epoch);
  return {
    epochs: sorted,
    totalDistributed: sorted.reduce((s, e) => s + BigInt(e.distributed), BigInt(0)).toString(),
    totalClaimed: sorted.reduce((s, e) => s + BigInt(e.claimed), BigInt(0)).toString(),
    decimals,
    partial,
    unverifiedEpochs: unverified,
  };
}

type SaleLike = { kind: "primary" | "secondary"; priceLamports: number; feeLamports: number; royaltyLamports: number; status: string };

/** Completed sales only. Primary and secondary are reported apart: they are different markets. */
export function nftSection(sales: SaleLike[]): NftSection {
  const out: NftSection = { primary: { sales: 0, volumeLamports: 0 }, secondary: { sales: 0, volumeLamports: 0 }, marketFeesLamports: 0, royaltiesLamports: 0 };
  for (const s of sales) {
    if (s.status !== "COMPLETED") continue;
    const k = s.kind === "primary" ? out.primary : out.secondary;
    k.sales++;
    k.volumeLamports += s.priceLamports;
    out.marketFeesLamports += s.feeLamports;
    out.royaltiesLamports += s.royaltyLamports;
  }
  return out;
}

// ---- assembly ---------------------------------------------------------------------------------------

export type EconomyDeps = {
  now: () => number;
  total: () => Promise<{ since: number | null; metrics: Metrics }>;
  days: (now: number, n: number) => Promise<{ day: string; metrics: Metrics }[]>;
  ledgers: () => Promise<{ ledgers: LedgerLike[]; partial: boolean }>;
  airdrops: () => Promise<{ epochs: AirdropEpoch[]; partial: boolean; unverified: number[]; decimals: number | null }>;
  sales: () => Promise<SaleLike[]>;
};

async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function buildEconomy(deps: EconomyDeps): Promise<EconomySnapshot> {
  const now = deps.now();
  const [total, days, rewards, airdrops, sales] = await Promise.all([
    attempt(deps.total),
    attempt(() => deps.days(now, 14)),
    attempt(deps.ledgers),
    attempt(deps.airdrops),
    attempt(deps.sales),
  ]);
  const metricsOk = total !== null;
  return {
    generatedAt: now,
    volume: total && days ? volumeSection(total, days) : total ? volumeSection(total, []) : null,
    fees: total ? feesSection(total) : null,
    creatorFees: total ? creatorFeesSection(total) : null,
    rewards: rewards ? rewardsSection(rewards.ledgers, rewards.partial) : null,
    airdrops: airdrops ? airdropsSection(airdrops.epochs, airdrops.decimals, airdrops.partial, airdrops.unverified) : null,
    nft: sales ? nftSection(sales) : null,
    status: {
      pandaMetrics: metricsOk ? "ok" : "unavailable",
      rewards: rewards ? "ok" : "unavailable",
      airdrops: airdrops ? "ok" : "unavailable",
      nft: sales ? "ok" : "unavailable",
    },
  };
}
