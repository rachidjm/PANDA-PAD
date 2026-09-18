"use client";

import { useState } from "react";
import Link from "next/link";
import CoinCard from "@/components/CoinCard";
import LiveBadge from "@/components/LiveBadge";
import RefreshButton from "@/components/RefreshButton";
import { Coin } from "@/lib/types";

export default function HomeFeed({ coins: initialCoins, live: initialLive }: { coins: Coin[]; live: boolean }) {
  const [coins, setCoins] = useState(initialCoins);
  const [live, setLive] = useState(initialLive);
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

  const feed = [...coins].sort((a, b) => b.volume24h - a.volume24h);

  return (
    <section className="pb-24">
      <div className="mb-5 flex items-end justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-xl font-bold">Live coins</h2>
          <LiveBadge live={live} />
          <RefreshButton loading={refreshing} onClick={refresh} />
        </div>
        <Link href="/discover" className="text-sm font-medium text-paper/60 hover:text-paper transition-colors">
          View all
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {feed.slice(0, 8).map((coin) => (
          <CoinCard key={coin.mint} coin={coin} />
        ))}
      </div>
    </section>
  );
}
