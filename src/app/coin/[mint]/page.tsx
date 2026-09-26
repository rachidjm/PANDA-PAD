import { notFound } from "next/navigation";
import { getLiveCoinBase, enrichCoinDetail, getCoinTrades } from "@/lib/live-coins";
import CoinClient from "@/components/coin/CoinClient";
import TokenNoMarket from "@/components/coin/TokenNoMarket";
import { addressFromInput } from "@/lib/solana/address";
import { fetchTokenInfo } from "@/lib/gecko/client";

export default async function CoinPage({ params }: PageProps<"/coin/[mint]">) {
  const { mint } = await params;
  const { coin: base, live } = await getLiveCoinBase(mint);
  if (!base) {
    // Any valid Solana token address opens a page: with no market to trade it shows who it is, its address and RugCheck's view — never a fake price.
    const address = addressFromInput(mint);
    if (!address) notFound();
    const info = await fetchTokenInfo(address);
    return <TokenNoMarket mint={address} name={info?.name} symbol={info?.symbol} image={info?.image_url} />;
  }

  // The coin's own detail fetches (closes, socials, Pump.fun info) and its trade
  // history don't depend on each other — running them together instead of one
  // after another is most of why opening a coin used to feel slow.
  const [coin, { trades, live: tradesLive }] = await Promise.all([
    enrichCoinDetail(base),
    getCoinTrades(base),
  ]);

  return <CoinClient coin={coin} trades={trades} live={live} tradesLive={tradesLive} />;
}
