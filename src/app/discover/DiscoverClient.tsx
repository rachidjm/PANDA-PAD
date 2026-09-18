"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CoinCard from "@/components/CoinCard";
import LiveBadge from "@/components/LiveBadge";
import RefreshButton from "@/components/RefreshButton";
import Panda from "@/components/panda/Panda";
import { Coin } from "@/lib/types";

const sorts = [
  { id: "new", label: "New" },
  { id: "trending", label: "Trending" },
  { id: "mcap", label: "Market cap" },
  { id: "volume", label: "Volume" },
] as const;

type SortId = (typeof sorts)[number]["id"];

export default function DiscoverClient({ coins: initialCoins, live: initialLive }: { coins: Coin[]; live: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") || "";
  const [coins, setCoins] = useState(initialCoins);
  const [live, setLive] = useState(initialLive);
  const [sort, setSort] = useState<SortId>("trending");
  const [inputValue, setInputValue] = useState(urlQuery);
  const [searchResults, setSearchResults] = useState<Coin[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const trimmedQuery = urlQuery.trim();
  const searching = trimmedQuery !== "" && trimmedQuery !== resolvedQuery;
  const navDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          setSearchError(data.error || "Search failed. Try again.");
          setSearchResults([]);
        } else {
          setSearchError("");
          setSearchResults(data.coins || []);
        }
        setResolvedQuery(q);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchError("Search failed. Check your connection and try again.");
        setSearchResults([]);
        setResolvedQuery(q);
      });
    return () => {
      cancelled = true;
    };
  }, [urlQuery]);

  function refresh() {
    setRefreshing(true);
    fetch("/api/coins?force=1")
      .then((r) => r.json())
      .then((data: { coins?: Coin[]; live?: boolean }) => {
        if (data.coins?.length) {
          setCoins(data.coins);
          setLive(!!data.live);
        }
      })
      .finally(() => setRefreshing(false));
  }

  const list = useMemo(() => {
    const base = urlQuery.trim() ? searchResults ?? [] : coins;
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
          <h1 className="font-display text-2xl font-bold">Discover</h1>
          <LiveBadge live={live} />
          <RefreshButton loading={refreshing} onClick={refresh} />
        </div>
        <input
          value={inputValue}
          onChange={(e) => typeQuery(e.target.value)}
          placeholder="Search all Solana coins"
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
            {s.label}
          </button>
        ))}
      </div>

      {list.length === 0 && !searching ? (
        <EmptyState query={urlQuery} error={searchError} />
      ) : (
        <div className={`mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity ${searching ? "opacity-60" : ""}`}>
          {list.map((coin) => (
            <CoinCard key={coin.mint} coin={coin} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ query, error }: { query: string; error?: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <Panda pose="empty" size={140} />
      {error ? (
        <p className="text-clay-red">{error}</p>
      ) : query ? (
        <p className="text-panda-grey">No coins match &ldquo;{query}&rdquo;. Try a different search, or create it yourself.</p>
      ) : (
        <p className="text-panda-grey">No coins to show right now.</p>
      )}
    </div>
  );
}
