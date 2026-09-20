"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { lamportsToSol } from "@/lib/market/format";
import Countdown from "./Countdown";
import NftGrid from "./NftGrid";
import StatusPill from "./StatusPill";
import BranchesSection from "@/components/branches/BranchesSection";
import Tabs, { tabId, tabPanelId } from "@/components/ui/Tabs";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { isOpen, MarketInfo, NftView, ThemeView } from "./types";

type MarketData = {
  stats: { listed: number; floorLamports: number | null; volumeLamports: number; sales: number };
  sales: { asset: string; buyer: string; seller: string; kind: "primary" | "secondary"; priceLamports: number; signature: string | null; completedAt: number | null }[];
};
type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; theme: ThemeView; nfts: NftView[]; market: MarketInfo; marketData: MarketData | null };

const solStr = (lamports: string) => {
  const n = Number(lamports) / 1e9;
  return `${n >= 1 ? n.toFixed(2) : n.toPrecision(2)} SOL`;
};
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export default function ThemeDetailClient({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/themes?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (r.status === 404) return setState({ kind: "missing" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { theme: ThemeView; nfts: NftView[]; market: MarketInfo };
      let marketData: MarketData | null = null;
      if (d.market?.enabled) {
        const m = await fetch(`/api/market/listings?theme=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (m.ok) marketData = (await m.json()) as MarketData;
      }
      setState({ kind: "ready", theme: d.theme, nfts: d.nfts, market: d.market ?? { enabled: false, secondaryEnabled: false, feeBps: 0 }, marketData });
    } catch {
      setState({ kind: "error" });
    }
  }, [slug]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12" aria-hidden>
        <div className="h-64 animate-pulse rounded-[28px] border border-paper/10 bg-ink-raised" />
      </div>
    );
  }
  if (state.kind !== "ready") {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12">
        <BackLink />
        <p className="mt-6 text-panda-grey">{state.kind === "missing" ? t("th.notFound") : t("th.loadError")}</p>
      </div>
    );
  }

  const { theme, nfts, market, marketData } = state;
  const open = isOpen(theme, now) && theme.status === "ACTIVE";
  const live = theme.status === "ACTIVE";
  const upcoming = theme.status === "SCHEDULED";
  const hasPool = Number(theme.rewardPool.lamports) > 0;
  const nameOf = (asset: string) => nfts.find((n) => n.asset === asset)?.name ?? short(asset);

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <BackLink />

      <section className="mt-5 rounded-[28px] border border-paper/10 bg-ink-raised p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <StatusPill status={theme.status} />
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">{theme.title}</h1>
          </div>
          {(live || upcoming) && (
            <div className="rounded-2xl bg-ink px-5 py-3 text-right">
              <p className="text-xs text-panda-grey">{live ? t("th.endsIn") : t("th.startsIn")}</p>
              <Countdown target={live ? theme.endTime : theme.startTime} className="text-2xl font-bold" />
            </div>
          )}
        </div>

        <p className="mt-4 max-w-3xl text-paper/80">{theme.description}</p>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="NFT" value={String(theme.nfts)} />
          <Stat label={t("th.royalty")} value={`${theme.royaltyBps / 100}%`} />
          <Stat label={t("th.limit")} value={String(theme.creationLimit)} />
          {hasPool && <Stat label={t("th.rewardPool")} value={solStr(theme.rewardPool.lamports)} />}
        </dl>

        <div className="mt-6 rounded-2xl bg-ink px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-panda-grey">{t("th.rules")}</p>
          <p className="mt-2 whitespace-pre-line text-sm text-paper/80">{theme.rules}</p>
        </div>

        <div className="mt-6">
          {open ? (
            <Link
              href={`/themes/${theme.slug}/create`}
              className="inline-block rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink transition hover:brightness-90"
            >
              {t("th.create")}
            </Link>
          ) : (
            <p className="text-sm text-panda-grey">{upcoming ? t("th.notStarted") : t("th.closedNote")}</p>
          )}
        </div>
      </section>

      {market.enabled && marketData && (
        <section className="mt-10">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("mk.listed")} value={String(marketData.stats.listed)} />
            <Stat label={t("mk.floor")} value={marketData.stats.floorLamports === null ? "—" : `◎ ${lamportsToSol(marketData.stats.floorLamports)}`} />
            <Stat label={t("mk.volume")} value={`◎ ${lamportsToSol(marketData.stats.volumeLamports)}`} />
            <Stat label={t("mk.sales")} value={String(marketData.stats.sales)} />
          </dl>
          <p className="mt-2 text-xs text-panda-grey">{t("mk.realOnly")}</p>
        </section>
      )}

      <ThemeTabs theme={theme} nfts={nfts} market={market} marketData={marketData} open={open} onChanged={() => void load()} nameOf={nameOf} />
    </div>
  );
}

type Tab = "nfts" | "creators" | "branches" | "activity";
type Sort = "new" | "sold";

/** NFTs / Creators / Branches / Activity of a theme. Every ranking here is computed from verified data — nothing is a guess. */
function ThemeTabs({
  theme,
  nfts,
  market,
  marketData,
  open,
  onChanged,
  nameOf,
}: {
  theme: ThemeView;
  nfts: NftView[];
  market: MarketInfo;
  marketData: MarketData | null;
  open: boolean;
  onChanged: () => void;
  nameOf: (asset: string) => string;
}) {
  const { t } = useLanguage();
  const { branches: branchesOn } = useFeatures();
  const [tab, setTab] = useState<Tab>("nfts");
  const [sort, setSort] = useState<Sort>("new");

  const sortedNfts = useMemo(() => [...nfts].sort((a, b) => (sort === "sold" ? b.sales - a.sales || b.publishedAt - a.publishedAt : b.publishedAt - a.publishedAt)), [nfts, sort]);
  const creators = useMemo(() => {
    const by = new Map<string, { creator: string; nfts: number; sales: number }>();
    for (const n of nfts) {
      const c = by.get(n.creator) ?? { creator: n.creator, nfts: 0, sales: 0 };
      c.nfts++;
      c.sales += n.sales;
      by.set(n.creator, c);
    }
    return [...by.values()].sort((a, b) => b.sales - a.sales || b.nfts - a.nfts || (a.creator < b.creator ? -1 : 1));
  }, [nfts]);

  const showActivity = market.enabled && marketData !== null;
  const tabs = [
    { id: "nfts" as const, label: "NFT", count: nfts.length },
    { id: "creators" as const, label: t("th.tabCreators"), count: creators.length },
    ...(branchesOn ? [{ id: "branches" as const, label: t("br.title") }] : []),
    ...(showActivity ? [{ id: "activity" as const, label: t("th.tabActivity") }] : []),
  ];
  const base = `theme-${theme.themeId}`;
  const panel = (id: Tab) => ({ role: "tabpanel" as const, id: tabPanelId(base, id), "aria-labelledby": tabId(base, id), tabIndex: 0, className: "mt-6 outline-none" });

  return (
    <section className="mt-10">
      <Tabs idBase={base} label={t("th.tabsLabel")} tabs={tabs} value={tab} onChange={setTab} variant="underline" />

      {tab === "nfts" && (
        <div {...panel("nfts")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-panda-grey">{sort === "sold" ? t("th.sortSoldNote") : t("th.verifiedNote")}</p>
            {nfts.length > 1 && (
              <div className="flex gap-1" role="group" aria-label={t("th.sortLabel")}>
                {(["new", "sold"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setSort(k)}
                    aria-pressed={sort === k}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${sort === k ? "bg-paper/10 text-paper" : "text-panda-grey hover:text-paper"}`}
                  >
                    {k === "new" ? t("th.sortNew") : t("th.sortSold")}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-5">
            {nfts.length === 0 ? (
              <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-8 text-center text-panda-grey">{open ? t("th.empty") : t("th.emptyClosed")}</div>
            ) : (
              <NftGrid items={sortedNfts} market={market} onChanged={onChanged} />
            )}
          </div>
        </div>
      )}

      {tab === "creators" && (
        <div {...panel("creators")}>
          <p className="text-xs text-panda-grey">{t("th.creatorsNote")}</p>
          {creators.length === 0 ? (
            <div className="mt-5 rounded-[24px] border border-paper/10 bg-ink-raised p-8 text-center text-panda-grey">{t("th.noCreators")}</div>
          ) : (
            <ol className="mt-5 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
              {creators.map((c, i) => (
                <li key={c.creator} className="flex items-center gap-4 px-5 py-3.5 text-sm">
                  <span className="w-6 text-panda-grey">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{short(c.creator)}</span>
                  <span className="text-panda-grey">{t("th.creatorNfts", { n: c.nfts })}</span>
                  {market.enabled && <span className="w-20 text-right font-medium">{t(c.sales === 1 ? "th.creatorSalesOne" : "th.creatorSalesMany", { n: c.sales })}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === "branches" && (
        <div {...panel("branches")}>
          <BranchesSection themeSlug={theme.slug} themeStatus={theme.status} />
        </div>
      )}

      {tab === "activity" && showActivity && marketData && (
        <div {...panel("activity")}>
          <h2 className="font-display text-2xl font-bold">{t("mk.recentSales")}</h2>
          {marketData.sales.length === 0 ? (
            <p className="mt-3 text-sm text-panda-grey">{t("mk.noSales")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
              {marketData.sales.map((s) => (
                <li key={`${s.asset}-${s.signature}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{nameOf(s.asset)}</span>
                  <span className="text-xs text-panda-grey">{s.kind === "primary" ? t("mk.primary") : t("mk.secondary")}</span>
                  <span className="font-mono text-xs text-panda-grey">
                    {short(s.seller)} → {short(s.buyer)}
                  </span>
                  <span className="font-semibold">◎ {lamportsToSol(s.priceLamports)}</span>
                  {s.signature && (
                    <a href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer" className="text-xs text-panda-grey underline-offset-2 hover:text-paper hover:underline">
                      tx
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function BackLink() {
  const { t } = useLanguage();
  return (
    <Link href="/themes" className="text-sm text-panda-grey transition-colors hover:text-paper">
      ← {t("th.back")}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-ink px-4 py-3">
      <dt className="text-xs text-panda-grey">{label}</dt>
      <dd className="mt-0.5 font-display text-lg font-bold">{value}</dd>
    </div>
  );
}
