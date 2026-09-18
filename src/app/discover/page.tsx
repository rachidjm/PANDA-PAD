import { getLiveCoins } from "@/lib/live-coins";
import DiscoverClient from "./DiscoverClient";

export default async function DiscoverPage() {
  const { coins, live } = await getLiveCoins();
  return <DiscoverClient coins={coins} live={live} />;
}
