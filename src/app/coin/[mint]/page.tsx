import { notFound } from "next/navigation";
import { getLiveCoinBase, enrichCoinDetail, getCoinTrades } from "@/lib/live-coins";
import CoinClient from "@/components/coin/CoinClient";

export default async function CoinPage({ params }: PageProps<"/coin/[mint]">) {
  const { mint } = await params;
  const { coin: base, live } = await getLiveCoinBase(mint);
  if (!base) notFound();

  // The coin's own detail fetches (closes, socials, Pump.fun info) and its trade
  // history don't depend on each other — running them together instead of one
  // after another is most of why opening a coin used to feel slow.
  const [coin, { trades, live: tradesLive }] = await Promise.all([
    enrichCoinDetail(base),
    getCoinTrades(base),
  ]);

  return <CoinClient coin={coin} trades={trades} live={live} tradesLive={tradesLive} />;
}
