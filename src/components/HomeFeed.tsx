"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import LiveBadge from "@/components/LiveBadge";
import RefreshButton from "@/components/RefreshButton";
import ActivityFeed from "@/components/ActivityFeed";
import HomeSection from "@/components/home/HomeSection";
import PandaEcosystemCard from "@/components/home/PandaEcosystemCard";
import ActivitySidebar from "@/components/home/ActivitySidebar";
import { buildHomeSections, SECTION_TITLE_KEYS, SectionId } from "@/lib/home-sections";
import { ActivityEvent, Coin } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const REFRESH_COOLDOWN_MS = 3000;
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
  const [note, setNote] = useState<{ fresh: number; moved: number } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAttempt = useRef(0);
  const { t } = useLanguage();

  /** Says what the refresh actually did, so a click is never met with silence. */
  function showNote(n: { fresh: number; moved: number }) {
    setNote(n);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 6000);
  }

  function refresh() {
    if (refreshing) return;
    // Repeated clicks right after a failure just burn more of the shared
    // rate-limit budget without changing the outcome — space them out.
    if (Date.now() - lastAttempt.current < REFRESH_COOLDOWN_MS) {
      showNote({ fresh: 0, moved: 0 });
      return;
    }
    lastAttempt.current = Date.now();
    setRefreshing(true);
    setRefreshError(false);
    fetch("/api/coins?force=1")
      .then((r) => r.json())
      .then((data: { coins?: Coin[]; live?: boolean }) => {
        if (data.coins?.length) {
          const before = new Map(coins.map((c) => [c.mint, c]));
          const fresh = data.coins.filter((c) => !before.has(c.mint)).length;
          const moved = data.coins.filter((c) => {
            const old = before.get(c.mint);
            return old && (old.marketCap !== c.marketCap || old.changePct !== c.changePct);
          }).length;
          setCoins(data.coins);
          if (data.live) showNote({ fresh, moved });
        }
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

  // A coin with no picture at all isn't shown here (a missing logo looks broken); Discover and search still list everything.
  const sections = buildHomeSections(coins.filter((c) => !!c.image));

  return (
    <section className="pb-24">
      {/* The PANDA strip stays under the header for a while as the page scrolls (about 550px), then moves on with the page.
          The tall, click-through box only defines how long it sticks; the negative margin gives the space back, so nothing is left empty. */}
      <div className="pointer-events-none relative z-30 -mb-[528px] h-[600px]">
        <div className="pointer-events-auto sticky top-[calc(var(--header-h,68px)+8px)]">
          <PandaEcosystemCard />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="whitespace-nowrap font-display text-xl font-bold">{t("home.liveCoins")}</h2>
              <LiveBadge live={live} />
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <RefreshButton loading={refreshing} onClick={refresh} justUpdated={justUpdated} />
              <Link href="/discover" className="whitespace-nowrap text-sm font-medium text-paper/60 transition-colors hover:text-paper">
                {t("home.viewAll")}
              </Link>
            </div>
          </div>
          <p aria-live="polite" className="mb-3 min-h-4 text-xs text-panda-grey">
            {note ? (note.fresh === 0 && note.moved === 0 ? t("home.refreshSame") : t("home.refreshNote", { fresh: note.fresh, moved: note.moved })) : ""}
          </p>
          {refreshError && <p className="mb-4 text-xs text-clay-red">{t("home.refreshError")}</p>}

          {SECTION_ORDER.map((id) => (
            <HomeSection key={id} titleKey={SECTION_TITLE_KEYS[id]} coins={sections[id]} />
          ))}

          <div className="mt-2">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="font-display text-xl font-bold">{t("home.recentActivity")}</h2>
              <Link href="/activity" className="text-sm font-medium text-paper/60 transition-colors hover:text-paper">
                {t("act.seeAll")}
              </Link>
            </div>
            <ActivityFeed initialEvents={activityEvents} limit={8} />
          </div>
        </div>

        <ActivitySidebar />
      </div>
    </section>
  );
}
