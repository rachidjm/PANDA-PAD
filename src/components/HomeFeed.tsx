"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import LiveBadge from "@/components/LiveBadge";
import RefreshButton from "@/components/RefreshButton";
import ActivityFeed from "@/components/ActivityFeed";
import HomeSection from "@/components/home/HomeSection";
import { buildHomeSections, SECTION_TITLES, SectionId } from "@/lib/home-sections";
import { ActivityEvent, Coin } from "@/lib/types";

const REFRESH_COOLDOWN_MS = 8000;
const SECTION_ORDER: SectionId[] = ["trending", "topGainers", "recentlyActive", "new", "graduated"];

export default function HomeFeed({
  coins: initialCoins,
  live: initialLive,
  activityEvents,
}: {
  coins: Coin[];
  live: boolean;
  activityEvents: ActivityEvent[];
}) {
  const [coins, setCoins] = useState(initialCoins);
  const [live, setLive] = useState(initialLive);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const lastAttempt = useRef(0);

  function refresh() {
    if (refreshing) return;
    // Repeated clicks right after a failure just burn more of the shared
    // rate-limit budget without changing the outcome — space them out.
    if (Date.now() - lastAttempt.current < REFRESH_COOLDOWN_MS) return;
    lastAttempt.current = Date.now();
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

  const sections = buildHomeSections(coins);

  return (
    <section className="pb-24">
      <div className="mb-5 flex items-end justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-xl font-bold">Live coins</h2>
          <LiveBadge live={live} />
          <RefreshButton loading={refreshing} onClick={refresh} justUpdated={justUpdated} />
        </div>
        <Link href="/discover" className="text-sm font-medium text-paper/60 hover:text-paper transition-colors">
          View all
        </Link>
      </div>
      {refreshError && (
        <p className="mb-4 text-xs text-clay-red">
          Couldn&apos;t refresh (data source is rate-limited right now) — showing the last known prices.
        </p>
      )}

      {SECTION_ORDER.map((id) => (
        <HomeSection key={id} title={SECTION_TITLES[id]} coins={sections[id]} />
      ))}

      <div className="mt-2">
        <h2 className="mb-4 font-display text-xl font-bold">Recent activity</h2>
        <ActivityFeed initialEvents={activityEvents} limit={8} />
      </div>
    </section>
  );
}
