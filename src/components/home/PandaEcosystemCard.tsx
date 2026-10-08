"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Logo from "@/components/Logo";
import CoinAvatar from "@/components/CoinAvatar";
import BuyPandaWidget from "@/components/BuyPandaWidget";
import { Coin } from "@/lib/types";
import { formatCompact, formatPct, formatPrice } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** The top-of-home $PANDA strip: before launch, a quiet "hasn't launched yet" pill; once NEXT_PUBLIC_PANDA_TOKEN_MINT
 *  is set and the mint is readable, its real logo, live price, market cap and 24h change — the whole strip (except
 *  the Buy button, its own control) links to $PANDA's coin page. */
export default function PandaEcosystemCard({ coin }: { coin: Coin | null }) {
  const { t } = useLanguage();
  const positive = (coin?.changePct ?? 0) >= 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative flex h-12 items-center justify-between gap-3 rounded-2xl border border-paper/10 bg-ink-raised px-3 shadow-[0_6px_20px_rgba(0,0,0,0.35)] sm:px-4"
    >
      {coin ? (
        <Link href={`/coin/${coin.mint}`} className="flex min-w-0 flex-1 items-center gap-2.5 transition-opacity hover:opacity-85">
          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-ink">
            <CoinAvatar image={coin.image} ticker={coin.ticker} mint={coin.mint} />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="hidden truncate text-[9px] font-semibold uppercase tracking-wide text-panda-grey sm:block">{t("home.ecosystemLabel")}</p>
            <div className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium">
              <span className="shrink-0 font-display font-bold">$PANDA</span>
              {coin.livePriceUsd !== undefined && <span className="shrink-0 truncate text-paper/90">{formatPrice(coin.livePriceUsd)}</span>}
              <span className={`hidden shrink-0 text-xs font-semibold sm:inline ${positive ? "text-bamboo" : "text-clay-red"}`}>{formatPct(coin.changePct)}</span>
              <span className="hidden shrink-0 text-panda-grey md:inline">· {t("coinCard.mc")} {formatCompact(coin.marketCap)}</span>
            </div>
          </div>
        </Link>
      ) : (
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo size={28} />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-panda-grey">{t("home.ecosystemLabel")}</p>
            <p className="truncate text-sm font-medium">
              <span className="font-display font-bold">$PANDA</span>
              <span className="hidden text-panda-grey sm:inline"> {t("home.ecosystemBlurb")}</span>
            </p>
          </div>
        </div>
      )}
      <BuyPandaWidget />
    </motion.section>
  );
}
