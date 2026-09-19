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
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#171512] p-8">
        <div className="h-full w-full overflow-hidden">
          <CoinAvatar image={coin.image} ticker={coin.ticker} size="lg" />
        </div>
        <span className="absolute right-3 top-3 rounded-full bg-ink/75 px-2.5 py-1 text-[11px] font-semibold text-paper/80 backdrop-blur">
          <CoinAge createdAt={coin.createdAt} source={coin.source} />
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-lg font-bold">${coin.ticker}</span>
          <span className={`text-sm font-semibold ${positive ? "text-bamboo" : "text-clay-red"}`}>
            {formatPct(coin.changePct)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-panda-grey">{coin.name}</p>

        <div className="mt-3 flex items-end justify-between gap-2">
          <dl className="space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="text-panda-grey">{t("coinCard.mc")}</dt>
              <dd className="font-medium">{formatCompact(coin.marketCap)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-panda-grey">{t("coinCard.vol")}</dt>
              <dd className="font-medium">{formatCompact(coin.volume24h)}</dd>
            </div>
          </dl>
          <Sparkline data={coin.priceHistory} positive={positive} />
        </div>
      </div>
    </Link>
  );
}
