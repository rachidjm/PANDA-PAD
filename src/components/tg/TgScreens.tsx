"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CoinAvatar from "@/components/CoinAvatar";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { Change, money, priceLabel, shortMint as short } from "./bits";
import { ALERTS, putCached, WATCHLIST } from "./cache";

export { ALERTS, WATCHLIST };
import { RowsSkeleton, ScreenSkeleton } from "./TgSkeleton";
import { useTg } from "./TgShell";
import { useTgData } from "./useTgData";

export { Change, money, priceLabel };

/** The Mini App's list screens: explore (trending / new on PANDA / search), the watchlist and the alerts. */

export type TgCoinRow = { mint: string; ticker: string | null; name: string | null; image: string | null; priceUsd: number | null; marketCap: number | null; change24h: number | null; volume24h?: number | null };
export type TgAlert = { id: string; mint: string; ticker: string; metric: "price" | "mcap"; direction: "above" | "below"; value: number };

export function CoinRow({ c, right }: { c: TgCoinRow; right?: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <li className="flex items-center gap-3 border-b border-paper/10 py-2.5 last:border-b-0">
      <Link href={`/tg/coin/${c.mint}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-paper/10 bg-[#171512]">
          <CoinAvatar image={c.image ?? undefined} ticker={c.ticker ?? "?"} mint={c.mint} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{c.ticker ? `$${c.ticker}` : short(c.mint)}</span>
          <span className="block truncate text-xs text-panda-grey">{c.name ?? short(c.mint)}</span>
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-sm font-semibold">{priceLabel(c.priceUsd)}</span>
          <span className="block text-xs text-panda-grey">
            {t("tg.mcap")} {money(c.marketCap)} · <Change pct={c.change24h} />
          </span>
        </span>
      </Link>
      {right}
    </li>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-panda-grey">{text}</p>;
}


export function TgExplore() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"trending" | "new">("trending");
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");

  // The search waits for a pause in typing.
  useEffect(() => {
    const id = setTimeout(() => setQuery(typed.trim()), 400);
    return () => clearTimeout(id);
  }, [typed]);

  // A list that was already seen is on screen at once (and brought up to date behind); the other tab is fetched too,
  // so switching is instant.
  const { data, failed } = useTgData<{ coins?: TgCoinRow[] }>(query ? `/api/tg/coins?q=${encodeURIComponent(query)}` : `/api/tg/coins?tab=${tab}`);
  useTgData<unknown>(query ? null : `/api/tg/coins?tab=${tab === "trending" ? "new" : "trending"}`);
  const coins = data?.coins;

  const tabs: { id: "trending" | "new"; label: DictKey }[] = [
    { id: "trending", label: "tg.tab.trending" },
    { id: "new", label: "tg.tab.new" },
  ];
  return (
    <div>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value.slice(0, 44))}
        placeholder={t("tg.search")}
        aria-label={t("tg.search")}
        inputMode="search"
        autoCapitalize="none"
        autoCorrect="off"
        className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
      />
      {!query && (
        <div className="mt-3 inline-flex gap-0.5 rounded-full bg-ink-raised p-0.5" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={`min-h-11 rounded-full px-4 text-xs font-semibold ${tab === x.id ? "bg-paper text-ink" : "text-panda-grey"}`}>
              {t(x.label)}
            </button>
          ))}
        </div>
      )}
      {!coins ? (
        failed ? (
          <Notice text={t("tg.unavailable")} />
        ) : (
          <RowsSkeleton />
        )
      ) : coins.length === 0 ? (
        <Notice text={t(query ? "tg.noResults" : "tg.empty")} />
      ) : (
        <ul className="mt-2">
          {coins.map((c) => (
            <CoinRow key={c.mint} c={c} />
          ))}
        </ul>
      )}
      <p className="mt-4 text-center text-[11px] text-panda-grey">{t("tg.nfa")}</p>
    </div>
  );
}

export function TgWatchlist() {
  const { t } = useLanguage();
  const { api } = useTg();
  const { data, failed, reload } = useTgData<{ items?: TgCoinRow[] }>(WATCHLIST);
  const items = data?.items;
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(mint: string) {
    setBusy(mint);
    // Gone from the screen at once; the server is told behind, and the list is read again in case it said no.
    if (items) putCached(WATCHLIST, { items: items.filter((c) => c.mint !== mint) });
    try {
      await api(WATCHLIST, { method: "DELETE", body: { mint } });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-xl font-bold">{t("tg.nav.watchlist")}</h1>
      {!items ? (
        failed ? (
          <Notice text={t("tg.unavailable")} />
        ) : (
          <RowsSkeleton rows={4} />
        )
      ) : items.length === 0 ? (
        <Notice text={t("tg.watch.empty")} />
      ) : (
        <ul className="mt-2">
          {items.map((c) => (
            <CoinRow
              key={c.mint}
              c={c}
              right={
                <button type="button" onClick={() => remove(c.mint)} disabled={busy === c.mint} aria-label={t("tg.watch.removeShort")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-panda-grey hover:bg-paper/10 disabled:opacity-40">
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function alertText(a: Pick<TgAlert, "metric" | "direction" | "value">, t: (k: DictKey) => string): string {
  return `${t(a.metric === "price" ? "tg.alert.metric.price" : "tg.alert.metric.mcap")} ${t(a.direction === "above" ? "tg.alert.above" : "tg.alert.below")} ${a.metric === "price" ? priceLabel(a.value) : money(a.value)}`;
}

export function TgAlerts() {
  const { t } = useLanguage();
  const { api } = useTg();
  const { data, failed, reload } = useTgData<{ alerts?: TgAlert[] }>(ALERTS);
  const alerts = data?.alerts;
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    if (alerts) putCached(ALERTS, { alerts: alerts.filter((a) => a.id !== id) });
    try {
      await api(ALERTS, { method: "DELETE", body: { id } });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-xl font-bold">{t("tg.nav.alerts")}</h1>
      <p className="mt-1 text-xs text-panda-grey">{t("tg.alert.note")}</p>
      {!alerts ? (
        failed ? (
          <Notice text={t("tg.unavailable")} />
        ) : (
          <RowsSkeleton rows={3} />
        )
      ) : alerts.length === 0 ? (
        <Notice text={t("tg.alert.empty")} />
      ) : (
        <ul className="mt-3 space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-paper/10 bg-ink-raised px-4 py-3">
              <Link href={`/tg/coin/${a.mint}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">${a.ticker}</span>
                <span className="block truncate text-xs text-panda-grey">{alertText(a, t)}</span>
              </Link>
              <button type="button" onClick={() => remove(a.id)} disabled={busy === a.id} className="min-h-11 shrink-0 rounded-full border border-paper/15 px-3 text-xs font-semibold text-paper/80 disabled:opacity-40">
                {t("tg.alert.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The screen for the address on screen, straight away (src/app/tg/loading.tsx): tapping Explore, Watchlist or Alerts
 * shows that screen at once — with what the app already has in memory — instead of waiting for the server to answer.
 */
export function TgInstant() {
  const pathname = usePathname();
  if (pathname === "/tg") return <TgExplore />;
  if (pathname === "/tg/watchlist") return <TgWatchlist />;
  if (pathname === "/tg/alerts") return <TgAlerts />;
  return <ScreenSkeleton />;
}
