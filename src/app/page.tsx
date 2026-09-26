import HomeFeed from "@/components/HomeFeed";
import { getLiveCoins, getRecentActivity } from "@/lib/live-coins";

export default async function Home() {
  const [{ coins, live }, { events }] = await Promise.all([getLiveCoins(), getRecentActivity()]);

  return (
    <div className="mx-auto max-w-6xl px-5">
      <h1 className="sr-only">PANDA — The Solana coin launchpad</h1>
      <HomeFeed coins={coins} live={live} activityEvents={events} />
    </div>
  );
}
