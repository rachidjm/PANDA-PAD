"use client";

import { useMemo, useState } from "react";
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
  const [coins, setCoins] = useState(initialCoins);
  const [live, setLive] = useState(initialLive);
  const [sort, setSort] = useState<SortId>("trending");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

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
    const filtered = coins.filter(
      (c) =>
        c.ticker.toLowerCase().includes(query.toLowerCase()) ||
        c.name.toLowerCase().includes(query.toLowerCase())
    );
    const sorted = [...filtered];
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
  }, [coins, sort, query]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl font-bold">Discover</h1>
          <LiveBadge live={live} />
          <RefreshButton loading={refreshing} onClick={refresh} />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search coins"
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

      {list.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((coin) => (
            <CoinCard key={coin.mint} coin={coin} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <Panda pose="empty" size={140} />
      <p className="text-panda-grey">No coins match &ldquo;{query}&rdquo;. Try a different search, or create it yourself.</p>
    </div>
  );
}
