import { CoinSkeleton } from "@/components/tg/TgSkeleton";

/** On screen the instant a coin is tapped, while its data is on the way: what the list already showed of it, and the shape of the rest. */
export default function TgCoinLoading() {
  return <CoinSkeleton />;
}
