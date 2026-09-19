import { RewardSource } from "@/lib/types";

/**
 * Minimum real USD value a holder must hold of a coin to qualify for its
 * Holder Rewards — same threshold Pump.fun itself uses for its own
 * creator-fee-to-holders feature. Shared by the Create form's copy
 * (`FeeDistributionStep`) and Rewards' real eligibility filter
 * (`RewardsDashboard`) so the two never drift apart.
 */
export const MIN_HOLDING_USD_FOR_REWARDS = 20;

/**
 * Pure math over real inputs — same shape as `analytics.ts`/`home-sections.ts`.
 * Deliberately doesn't produce a reward *amount*: see the comment on
 * `RewardSource` in `types.ts` for why a per-coin SOL/token figure can't be
 * honestly derived from PANDA's shared Rewards Pool balance yet.
 */
export function computeRewardSource({
  coinMint,
  coinTicker,
  coinImage,
  coinDoodle,
  coinBg,
  holderBalance,
  circulatingSupply,
  holdersFeeBps,
  holderValueUsd,
}: {
  coinMint: string;
  coinTicker: string;
  coinImage?: string;
  coinDoodle: RewardSource["coinDoodle"];
  coinBg: string;
  holderBalance: number;
  circulatingSupply: number;
  holdersFeeBps: number;
  holderValueUsd?: number;
}): RewardSource {
  const holderSharePct = circulatingSupply > 0 ? (holderBalance / circulatingSupply) * 100 : 0;
  return {
    coinMint,
    coinTicker,
    coinImage,
    coinDoodle,
    coinBg,
    holderBalance,
    circulatingSupply,
    holderSharePct,
    holdersFeeBps,
    holderValueUsd,
  };
}

/** Whether a real, priced holding clears the real $MIN_HOLDING_USD_FOR_REWARDS eligibility bar.
 *  `undefined` (price unknown) is treated as not-yet-eligible — PANDA never claims eligibility it can't verify. */
export function meetsRewardsThreshold(holderValueUsd: number | undefined): boolean {
  return holderValueUsd !== undefined && holderValueUsd >= MIN_HOLDING_USD_FOR_REWARDS;
}
