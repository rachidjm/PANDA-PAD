import HomeFeed from "@/components/HomeFeed";
import { getLiveCoins, getRecentActivity } from "@/lib/live-coins";
import { getPandaToken } from "@/lib/panda-token";

export default async function Home() {
  const [{ coins, live }, { events }, pandaCoin] = await Promise.all([getLiveCoins(), getRecentActivity(), getPandaToken()]);

  return (
    <div className="mx-auto max-w-[1680px] px-5">
      <h1 className="sr-only">PANDA — The Solana coin launchpad</h1>
      <HomeFeed coins={coins} live={live} activityEvents={events} pandaCoin={pandaCoin} />
    </div>
  );
}
