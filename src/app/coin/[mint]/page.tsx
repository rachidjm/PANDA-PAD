import { notFound } from "next/navigation";
import { getLiveCoin, getCoinTrades } from "@/lib/live-coins";
import CoinClient from "@/components/coin/CoinClient";

export default async function CoinPage({ params }: PageProps<"/coin/[mint]">) {
  const { mint } = await params;
  const { coin, live } = await getLiveCoin(mint);
  if (!coin) notFound();

  const { trades, live: tradesLive } = await getCoinTrades(coin);

  return <CoinClient coin={coin} trades={trades} live={live} tradesLive={tradesLive} />;
}
