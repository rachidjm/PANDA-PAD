import { notFound } from "next/navigation";
import TgCoin from "@/components/tg/TgCoin";
import { enrichCoinDetail, getLiveCoinBase } from "@/lib/live-coins";
import { getHolderCount } from "@/lib/pump/holders-count";

/** The same coin data as the website's own coin page (/coin/[mint]), in the Mini App's frame. */
export default async function TgCoinPage({ params }: PageProps<"/tg/coin/[mint]">) {
  const { mint } = await params;
  const { coin: base } = await getLiveCoinBase(mint);
  if (!base) notFound();
  const [coin, holderCount] = await Promise.all([enrichCoinDetail(base), getHolderCount(base.mint).catch(() => null)]);
  return <TgCoin coin={coin} holderCount={holderCount} />;
}
