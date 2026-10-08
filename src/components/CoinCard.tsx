"use client";

import Link from "next/link";
import { Coin } from "@/lib/types";
import { formatCompact, formatPct } from "@/lib/format";
import CoinAvatar from "@/components/CoinAvatar";
import CoinAge from "@/components/CoinAge";
import Sparkline from "@/components/Sparkline";
import RugBadge from "@/components/RugBadge";
import CopyCa from "@/components/CopyCa";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function CoinCard({ coin, priority = false, verified = false }: { coin: Coin; priority?: boolean; verified?: boolean }) {
  const { t } = useLanguage();
  const positive = coin.changePct >= 0;

  return (
    <div className="sticker-card group relative overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised">
    <Link href={`/coin/${coin.mint}`} className="block">
      {/* Edge-to-edge, cropped and centered (object-cover in CoinAvatar) — never letterboxed with the
          background showing as bars down the sides, whatever the logo's own aspect ratio is. */}
      <div className="relative aspect-square overflow-hidden bg-[#171512] sm:aspect-[4/3]">
        <CoinAvatar image={coin.image} ticker={coin.ticker} size="lg" mint={coin.mint} priority={priority} />
        <RugBadge mint={coin.mint} className="absolute left-1.5 top-1.5 sm:left-3 sm:top-3" />
        <span className="absolute right-1.5 top-1.5 rounded-full bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold text-paper/80 backdrop-blur sm:right-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[11px]">
          <CoinAge createdAt={coin.createdAt} source={coin.source} verified={coin.launchVerified} />
        </span>
        {coin.launchedOnPanda && (
          <span
            title={t("coinCard.launchedOnPanda")}
            className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full border border-paper/20 bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold text-paper backdrop-blur sm:bottom-3 sm:left-3 sm:px-2 sm:text-[11px]"
          >
            <span aria-hidden>🐼</span>
            {t("coinCard.launchedOnPanda")}
          </span>
        )}
        {verified && (
          <span
            title={t("coinCard.verified")}
            className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-full border border-bamboo/40 bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold text-bamboo backdrop-blur sm:bottom-3 sm:right-3 sm:px-2 sm:text-[11px]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5 sm:h-3 sm:w-3" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {t("coinCard.verified")}
          </span>
        )}
      </div>
      <div className="p-2.5 sm:p-4">
        <div className="flex items-baseline justify-between gap-1.5 sm:gap-2">
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="truncate font-display text-sm font-bold sm:text-lg">${coin.ticker}</span>
            {/* Desktop: hidden until the card is hovered. Mobile: always there, just dim — no hover to reveal it. */}
            <CopyCa mint={coin.mint} variant="inline" className="opacity-40 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" />
          </span>
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
    </div>
  );
}
