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
import { applyAiCoinFilter, isActiveAiFilter, type AiCoinFilter } from "@/lib/ai/coin-filter";
import type { RugLevel } from "@/lib/rugcheck/summary";

/** Handed off from the AI Assistant's "Buscar monedas" (src/components/ai/SearchPanel.tsx) via localStorage
 *  — a same-browser handoff between two client components, not a URL param (the filter is a small structured
 *  object, not something worth round-tripping through query-string escaping); cleared by "Quitar filtro de
 *  IA" below, and documented in the Cookie Policy (see legal-content.ts's AI_ADDENDA). */
const AI_FILTER_KEY = "panda.ai.filter";

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

  // The AI Assistant's own filter, if it just handed one off — read once, a moment after mount (never in a
  // useState initializer: the server render always assumes none, so this can't cause a hydration mismatch).
  const [aiFilter, setAiFilter] = useState<AiCoinFilter | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(AI_FILTER_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AiCoinFilter;
          setAiFilter(parsed);
          if (parsed.sort) setSort(parsed.sort);
        }
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  function clearAiFilter() {
    setAiFilter(null);
    try {
      localStorage.removeItem(AI_FILTER_KEY);
    } catch {}
  }

  // Only fetched when the filter actually needs it (rugSafe) — RugCheck's own batch endpoint, same one
  // RugBadge.tsx uses per-card, just called once here for whichever coins are on screen right now.
  const [rugLevels, setRugLevels] = useState<Record<string, RugLevel>>({});
  useEffect(() => {
    if (!aiFilter?.rugSafe) return;
    let cancelled = false;
    const mints = coins.slice(0, 30).map((c) => c.mint);
    if (mints.length === 0) return;
    fetch(`/api/rugcheck?mints=${mints.join(",")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { results?: Record<string, { level: RugLevel }> } | null) => {
        if (cancelled || !data?.results) return;
        setRugLevels(Object.fromEntries(Object.entries(data.results).map(([m, s]) => [m, s.level])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [aiFilter?.rugSafe, coins]);

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
    return aiFilter && isActiveAiFilter(aiFilter) ? applyAiCoinFilter(sorted, aiFilter, rugLevels) : sorted;
  }, [coins, searchResults, sort, urlQuery, aiFilter, rugLevels]);

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

      {aiFilter && isActiveAiFilter(aiFilter) && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-full border border-meme-orange/40 bg-meme-orange/10 px-4 py-2 text-xs">
          <span className="font-medium text-paper">{t("ai.search.applied", { n: list.length })}</span>
          <button type="button" onClick={clearAiFilter} className="shrink-0 font-semibold text-meme-orange hover:brightness-110">
            {t("ai.search.clear")}
          </button>
        </div>
      )}

      {refreshError && <p className="mt-4 text-xs text-clay-red">{t("home.refreshError")}</p>}

      {list.length === 0 && !searching ? (
        <EmptyState query={urlQuery} error={searchError} />
      ) : (
        <div className={`mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 transition-opacity ${searching ? "opacity-60" : ""}`}>
          {list.map((coin, i) => (
            <CoinCard key={coin.mint} coin={coin} priority={i < 4} />
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
