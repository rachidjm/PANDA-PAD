import HomeFeed from "@/components/HomeFeed";
import Hero from "@/components/home/Hero";
import { getLiveCoins, getRecentActivity } from "@/lib/live-coins";

export default async function Home() {
  const [{ coins, live }, { events }] = await Promise.all([getLiveCoins(), getRecentActivity()]);

  return (
    <div className="mx-auto max-w-6xl px-5">
      <Hero />
      <HomeFeed coins={coins} live={live} activityEvents={events} />
    </div>
  );
}
