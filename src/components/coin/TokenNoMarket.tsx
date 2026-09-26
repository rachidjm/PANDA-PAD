"use client";

import Link from "next/link";
import Panda from "@/components/panda/Panda";
import CoinAvatar from "@/components/CoinAvatar";
import CopyCa from "@/components/CopyCa";
import RugBadge from "@/components/RugBadge";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** A valid Solana token address PANDA has no market for: its identity, its address to copy and RugCheck's view, and an honest "nothing to trade here". */
export default function TokenNoMarket({ mint, name, symbol, image }: { mint: string; name?: string; symbol?: string; image?: string | null }) {
  const { t } = useLanguage();
  return (
    <div className="mx-auto max-w-xl px-5 py-12">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-paper/10 bg-[#171512]">
          <CoinAvatar image={image ?? undefined} ticker={symbol || "?"} mint={mint} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{symbol ? `$${symbol}` : t("ca.noMarket.unnamed")}</h1>
          {name && <p className="truncate text-sm text-panda-grey">{name}</p>}
          <CopyCa mint={mint} className="mt-1" />
        </div>
        <Panda pose="empty" size={56} />
      </div>
      <RugBadge mint={mint} variant="full" className="mt-6" />
      <div className="mt-6 rounded-2xl border border-paper/10 bg-ink-raised p-5">
        <p className="font-semibold">{t("ca.noMarket.title")}</p>
        <p className="mt-1 text-sm text-panda-grey">{t("ca.noMarket.body")}</p>
        <Link href="/discover" className="mt-4 inline-block rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90">
          {t("home.exploreCta")}
        </Link>
      </div>
    </div>
  );
}
