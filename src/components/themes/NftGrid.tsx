"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import MarketActions from "./MarketActions";
import type { MarketInfo, NftView } from "./types";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Real, chain-verified NFTs only — the API never returns anything that hasn't been read back from the chain. */
export default function NftGrid({ items, market, onChanged }: { items: NftView[]; market?: MarketInfo; onChanged?: () => void }) {
  const { t } = useLanguage();
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((n) => (
        <li key={n.contentId} className="sticker-card group flex flex-col overflow-hidden rounded-[20px] border border-paper/10 bg-ink-raised">
          <a href={`https://solscan.io/token/${n.asset}`} target="_blank" rel="noreferrer" className="block flex-1" aria-label={`${n.name} — ${t("th.viewAsset")}`}>
            <div className="aspect-square overflow-hidden bg-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={n.imageUrl} alt={n.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            </div>
            <div className="px-3.5 py-3">
              <p className="truncate font-display text-sm font-bold">{n.name}</p>
              <p className="mt-0.5 truncate text-xs text-panda-grey">
                {t("th.by")} <span className="font-mono">{short(n.creator)}</span>
              </p>
            </div>
          </a>
          {market?.enabled && <MarketActions nft={n} market={market} onChanged={onChanged ?? (() => {})} />}
        </li>
      ))}
    </ul>
  );
}
