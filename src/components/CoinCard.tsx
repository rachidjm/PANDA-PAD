"use client";

import Link from "next/link";
import { Coin } from "@/lib/types";
import { formatCompact, formatPct } from "@/lib/format";
import CoinAvatar from "@/components/CoinAvatar";
import CoinAge from "@/components/CoinAge";
import Sparkline from "@/components/Sparkline";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function CoinCard({ coin }: { coin: Coin }) {
  const { t } = useLanguage();
  const positive = coin.changePct >= 0;

  return (
    <Link
      href={`/coin/${coin.mint}`}
      className="sticker-card group block overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised"
    >
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-[#171512] p-3 sm:aspect-[4/3] sm:p-8">
        <div className="h-full w-full overflow-hidden">
          <CoinAvatar image={coin.image} ticker={coin.ticker} size="lg" mint={coin.mint} />
        </div>
        <span className="absolute right-1.5 top-1.5 rounded-full bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold text-paper/80 backdrop-blur sm:right-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[11px]">
          <CoinAge createdAt={coin.createdAt} source={coin.source} verified={coin.launchVerified} />
        </span>
      </div>
      <div className="p-2.5 sm:p-4">
        <div className="flex items-baseline justify-between gap-1.5 sm:gap-2">
          <span className="truncate font-display text-sm font-bold sm:text-lg">${coin.ticker}</span>
          <span className={`shrink-0 text-[11px] font-semibold sm:text-sm ${positive ? "text-bamboo" : "text-clay-red"}`}>
            {formatPct(coin.changePct)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-panda-grey sm:text-sm">{coin.name}</p>

        <div className="mt-2 flex items-end justify-between gap-2 sm:mt-3">
          <dl className="space-y-0.5 text-[11px] sm:space-y-1 sm:text-xs">
            <div className="flex gap-2">
              <dt className="text-panda-grey">{t("coinCard.mc")}</dt>
              <dd className="font-medium">{formatCompact(coin.marketCap)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-panda-grey">{t("coinCard.vol")}</dt>
              <dd className="font-medium">{formatCompact(coin.volume24h)}</dd>
            </div>
          </dl>
          <span className="hidden sm:block">
            <Sparkline data={coin.priceHistory} positive={positive} />
          </span>
        </div>
      </div>
    </Link>
  );
}
