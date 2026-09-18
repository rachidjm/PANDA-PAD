import { getLiveCoins, getRecentActivity } from "@/lib/live-coins";
import { buildHomeSections } from "@/lib/home-sections";
import AnalyticsClient from "@/components/analytics/AnalyticsClient";

export default async function AnalyticsPage() {
  const [{ coins }, { events }] = await Promise.all([getLiveCoins(), getRecentActivity()]);
  const { trending } = buildHomeSections(coins);

  return <AnalyticsClient coins={coins} trending={trending} activityEvents={events} />;
}
