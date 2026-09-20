import { getLiveCoins, getRecentActivity } from "@/lib/live-coins";
import { buildHomeSections } from "@/lib/home-sections";
import AnalyticsClient from "@/components/analytics/AnalyticsClient";
import { PANDA_REWARDS_POOL, PANDA_TREASURY } from "@/lib/pump/constants";

export default async function AnalyticsPage() {
  const [{ coins }, { events }] = await Promise.all([getLiveCoins(), getRecentActivity()]);
  const { trending } = buildHomeSections(coins);

  // Public addresses, so anyone can inspect PANDA's wallets themselves.
  const addresses = {
    treasury: PANDA_TREASURY.toBase58(),
    rewardsPool: PANDA_REWARDS_POOL ? PANDA_REWARDS_POOL.toBase58() : null,
    tokenMint: process.env.NEXT_PUBLIC_PANDA_TOKEN_MINT || null,
  };
  return <AnalyticsClient coins={coins} trending={trending} activityEvents={events} addresses={addresses} />;
}
