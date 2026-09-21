"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CoinCard from "@/components/CoinCard";
import LiveBadge from "@/components/LiveBadge";
import RefreshButton from "@/components/RefreshButton";
import Panda from "@/components/panda/Panda";
import { Coin } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";

const sorts = [
  { id: "new", key: "discover.sort.new" },
  { id: "trending", key: "discover.sort.trending" },
  { id: "mcap", key: "discover.sort.mcap" },
  { id: "volume", key: "discover.sort.volume" },
] as const satisfies { id: string; key: DictKey }[];

type SortId = (typeof sorts)[number]["id"];
const REFRESH_COOLDOWN_MS = 8000;

export default function DiscoverClient({ coins: initialCoins, live: initialLive }: { coins: Coin[]; live: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const urlQuery = searchParams.get("q") || "";
  const [coins, setCoins] = useState(initialCoins);
  const [live, setLive] = useState(initialLive);
  const [sort, setSort] = useState<SortId>("trending");
  const [inputValue, setInputValue] = useState(urlQuery);
  const [searchResults, setSearchResults] = useState<Coin[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const trimmedQuery = urlQuery.trim();
  const searching = trimmedQuery !== "" && trimmedQuery !== resolvedQuery;
  const navDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAttempt = useRef(0);

  function typeQuery(value: string) {
    setInputValue(value);
    if (navDebounce.current) clearTimeout(navDebounce.current);
    navDebounce.current = setTimeout(() => {
      router.replace(value.trim() ? `/discover?q=${encodeURIComponent(value.trim())}` : "/discover", { scroll: false });
    }, 250);
  }

  // Live search across the whole Solana network (not just the cached list)
  // as soon as the URL's ?q= settles, so results appear without pressing Enter.
  useEffect(() => {
    const q = urlQuery.trim();
    if (!q) return;
    let cancelled = false;
    fetch(`/api/coins?q=${encodeURIComponent(q)}`)
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setSearchError(data.error || t("search.failed"));
          setSearchResults([]);
        } else {
          setSearchError("");
          setSearchResults(data.coins || []);
        }
        setResolvedQuery(q);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchError(t("search.failedConnection"));
        setSearchResults([]);
        setResolvedQuery(q);
      });
    return () => {
      cancelled = true;
    };
  }, [urlQuery, t]);

  function refresh() {
    if (refreshing) return;
    // Repeated clicks right after a failure just burn more of the shared
    // rate-limit budget without changing the outcome — space them out.
    if (Date.now() - lastRefreshAttempt.current < REFRESH_COOLDOWN_MS) return;
    lastRefreshAttempt.current = Date.now();
    setRefreshing(true);
    setRefreshError(false);
    fetch("/api/coins?force=1")
      .then((r) => r.json())
      .then((data: { coins?: Coin[]; live?: boolean }) => {
        if (data.coins?.length) setCoins(data.coins);
        setLive(!!data.live);
        if (!data.live) {
          setRefreshError(true);
        } else {
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 1800);
        }
      })
      .catch(() => setRefreshError(true))
      .finally(() => setRefreshing(false));
  }

  const list = useMemo(() => {
    // Browsing hides coins with no picture at all (a missing logo looks broken); a search still finds everything.
    const base = urlQuery.trim() ? searchResults ?? [] : coins.filter((c) => !!c.image);
    const sorted = [...base];
    switch (sort) {
      case "new":
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "mcap":
        sorted.sort((a, b) => b.marketCap - a.marketCap);
        break;
      case "volume":
        sorted.sort((a, b) => b.volume24h - a.volume24h);
        break;
      default:
        sorted.sort((a, b) => b.changePct - a.changePct);
    }
    return sorted;
  }, [coins, searchResults, sort, urlQuery]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl font-bold">{t("discover.title")}</h1>
          <LiveBadge live={live} />
          <RefreshButton loading={refreshing} onClick={refresh} justUpdated={justUpdated} />
        </div>
        <input
          value={inputValue}
          onChange={(e) => typeQuery(e.target.value)}
          placeholder={t("nav.searchPlaceholder")}
          aria-label={t("nav.searchPlaceholder")}
          className="w-full max-w-xs rounded-full border border-paper/15 bg-ink-raised px-4 py-2 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40 sm:hidden"
        />
      </div>

      <div className="mt-5 flex gap-1.5 overflow-x-auto pb-1">
        {sorts.map((s) => (
          <button
            key={s.id}
            onClick={() => setSort(s.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              sort === s.id ? "bg-paper/10 text-paper" : "text-paper/50 hover:text-paper/80"
            }`}
          >
            {t(s.key)}
          </button>
        ))}
      </div>

      {refreshError && <p className="mt-4 text-xs text-clay-red">{t("home.refreshError")}</p>}

      {list.length === 0 && !searching ? (
        <EmptyState query={urlQuery} error={searchError} />
      ) : (
        <div className={`mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 transition-opacity ${searching ? "opacity-60" : ""}`}>
          {list.map((coin) => (
            <CoinCard key={coin.mint} coin={coin} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ query, error }: { query: string; error?: string }) {
  const { t } = useLanguage();
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <Panda pose="empty" size={140} />
      {error ? (
        <p className="text-clay-red">{error}</p>
      ) : query ? (
        <p className="text-panda-grey">{t("discover.noMatch", { query })}</p>
      ) : (
        <p className="text-panda-grey">{t("discover.empty")}</p>
      )}
    </div>
  );
}
