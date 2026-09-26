"use client";

import Link from "next/link";
import Panda from "@/components/panda/Panda";
import CoinAvatar from "@/components/CoinAvatar";
import { formatRelativeTime, truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import type { FeedResult } from "@/lib/activity/service";
import { FEED_FILTERS, FeedEvent, FeedFilter, FeedKind } from "@/lib/activity/types";

export type LoadState = "loading" | "ready" | "error";

const FILTER_KEYS = {
  all: "act.fAll",
  created: "act.fCreated",
  trades: "act.fTrades",
  large: "act.fLarge",
  graduation: "act.fGraduation",
  fees: "act.fFees",
  rewards: "act.fRewards",
} as const satisfies Record<FeedFilter, string>;

const TITLE_KEYS = {
  token_created: "act.created",
  buy: "act.buy",
  sell: "act.sell",
  fee_distribution: "act.fees",
  reward_claim: "act.reward",
  graduation: "act.graduated",
} as const satisfies Record<FeedKind, string>;

/** The little round badge on a coin's logo: what kind of event it is. */
const BADGE: Record<FeedKind, { glyph: string; cls: string }> = {
  buy: { glyph: "↑", cls: "bg-bamboo text-ink" },
  sell: { glyph: "↓", cls: "bg-clay-red text-ink" },
  token_created: { glyph: "★", cls: "bg-meme-orange text-ink" },
  graduation: { glyph: "✦", cls: "bg-meme-orange text-ink" },
  fee_distribution: { glyph: "◎", cls: "bg-paper text-ink" },
  reward_claim: { glyph: "✓", cls: "bg-bamboo text-ink" },
};

const SOURCE_KEYS = { journal: "act.srcJournal", trades: "act.srcTrades", launches: "act.srcLaunches", graduations: "act.srcGraduations" } as const;

const sol = (lamports: number, lang: string) => (lamports / 1e9).toLocaleString(lang, { maximumFractionDigits: lamports >= 1e9 ? 2 : 4 });

function Row({ e }: { e: FeedEvent }) {
  const { t, lang } = useLanguage();
  const coin = e.ticker ? `$${e.ticker}` : truncateAddress(e.mint);
  const details = [
    e.wallet ? truncateAddress(e.wallet) : null,
    e.lamports !== undefined ? `${sol(e.lamports, lang)} SOL` : null,
    (e.kind === "buy" || e.kind === "sell") && e.tokenAmount ? `${e.tokenAmount.toLocaleString(lang, { maximumFractionDigits: e.tokenAmount >= 1000 ? 0 : 2 })} ${e.ticker ? `$${e.ticker}` : ""}`.trim() : null,
  ].filter(Boolean);
  const badge = BADGE[e.kind];

  return (
    <div className="flex items-center gap-3 p-4">
      <div className="relative shrink-0">
        <div className="h-10 w-10 overflow-hidden rounded-full bg-paper/10">
          <CoinAvatar image={e.image} ticker={e.ticker || "?"} />
        </div>
        <span className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none ring-2 ring-ink-raised ${badge.cls}`} aria-hidden>
          {badge.glyph}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
          <Link href={`/coin/${e.mint}`} className="hover:underline">
            {t(TITLE_KEYS[e.kind], { coin })}
          </Link>
          {e.large && <span className="rounded-full bg-meme-orange/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-meme-orange">{t("act.large")}</span>}
          {e.verified && (
            <span className="text-xs text-bamboo" title={t("act.verified")} aria-label={t("act.verified")}>
              ✓
            </span>
          )}
        </p>
        {details.length > 0 && <p className="text-xs text-panda-grey">{details.join(" · ")}</p>}
      </div>

      <div className="shrink-0 text-right text-xs text-panda-grey">
        <p>{formatRelativeTime(e.ts, lang)}</p>
        {e.signature ? (
          <a href={`https://solscan.io/tx/${e.signature}`} target="_blank" rel="noopener noreferrer" className="text-meme-orange hover:underline">
            {t("act.viewTx")} ↗
          </a>
        ) : (
          <Link href={`/coin/${e.mint}`} className="text-meme-orange hover:underline">
            {t("act.viewCoin")}
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ActivityView(p: {
  events: FeedEvent[];
  sources: FeedResult["sources"] | null;
  filter: FeedFilter;
  onFilter: (f: FeedFilter) => void;
  state: LoadState;
}) {
  const { holderRewards } = useFeatures(); // fee distributions and reward claims exist only while holder rewards are on
  const { t } = useLanguage();
  const down = p.sources ? (Object.keys(p.sources) as (keyof FeedResult["sources"])[]).filter((k) => p.sources![k] === "unavailable") : [];

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{t("act.title")}</h1>
          <p className="mt-1 text-sm text-panda-grey">{t("act.subtitle")}</p>
        </div>
        <Panda pose={p.state === "error" ? "error" : p.events.length > 0 ? "success" : "idle"} size={72} />
      </div>

      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={t("act.title")}>
        {FEED_FILTERS.filter((f) => holderRewards || (f !== "fees" && f !== "rewards")).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={p.filter === f}
            onClick={() => p.onFilter(f)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              p.filter === f ? "bg-paper text-ink" : "bg-ink-raised text-paper/60 hover:text-paper"
            }`}
          >
            {t(FILTER_KEYS[f])}
          </button>
        ))}
      </div>

      {down.length > 0 && p.state !== "loading" && (
        <p className="mt-3 rounded-xl bg-meme-orange/10 px-4 py-2.5 text-xs text-meme-orange">
          {t("act.unavailable", { list: down.map((k) => t(SOURCE_KEYS[k])).join(", ") })}
        </p>
      )}

      <div className="mt-4 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
        {p.state === "loading" && p.events.length === 0 && (
          <div className="space-y-1.5 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-paper/5" />
            ))}
          </div>
        )}
        {p.state === "error" && p.events.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <Panda pose="error" size={88} />
            <p className="text-sm text-clay-red">{t("act.loadError")}</p>
          </div>
        )}
        {p.state === "ready" && p.events.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <Panda pose="empty" size={88} />
            <p className="text-sm font-medium">{t("act.empty")}</p>
            <p className="text-xs text-panda-grey">{t("act.emptyHint")}</p>
          </div>
        )}
        {p.events.map((e) => (
          <Row key={e.id} e={e} />
        ))}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-panda-grey">{t(holderRewards ? "act.noticeHolders" : "act.notice")}</p>
    </div>
  );
}
