import { RewardSource } from "@/lib/types";

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
}: {
  coinMint: string;
  coinTicker: string;
  coinImage?: string;
  coinDoodle: RewardSource["coinDoodle"];
  coinBg: string;
  holderBalance: number;
  circulatingSupply: number;
  holdersFeeBps: number;
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
  };
}
