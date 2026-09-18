import { Suspense } from "react";
import { getLiveCoins } from "@/lib/live-coins";
import DiscoverClient from "./DiscoverClient";

export default async function DiscoverPage() {
  const { coins, live } = await getLiveCoins();
  return (
    <Suspense>
      <DiscoverClient coins={coins} live={live} />
    </Suspense>
  );
}
