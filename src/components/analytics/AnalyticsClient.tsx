"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import CoinAvatar from "@/components/CoinAvatar";
import Panda from "@/components/panda/Panda";
import ActivityFeed from "@/components/ActivityFeed";
import StatCard from "@/components/analytics/StatCard";
import BarChart from "@/components/analytics/BarChart";
import { computeRealStats, computeWindowVolume, computeLaunchRecency } from "@/lib/analytics";
import { formatCompact, formatPct } from "@/lib/format";
import { Coin, ActivityEvent } from "@/lib/types";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

export default function AnalyticsClient({
  coins,
  trending,
  activityEvents,
}: {
  coins: Coin[];
  trending: Coin[];
  activityEvents: ActivityEvent[];
}) {
  const stats = computeRealStats(coins);
  const volumeByWindow = computeWindowVolume(coins);
  const launchesByAge = computeLaunchRecency(coins);
  const activeShare = stats.tokensTracked ? (stats.activeTokens / stats.tokensTracked) * 100 : 0;
  const graduatedShare = stats.tokensTracked ? (stats.graduatedTokens / stats.tokensTracked) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <motion.div initial="hidden" animate="show" variants={fadeUp}>
        <h1 className="font-display text-2xl font-bold">Analytics</h1>
        <p className="mt-1 max-w-2xl text-sm text-panda-grey">
          Coin totals, volume and activity below are live from Solana, over the same coins Discover tracks. Time-series
          history and creator/protocol fees aren&apos;t wired up to a real data store yet — those are marked below.
        </p>
      </motion.div>

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <motion.div variants={fadeUp}>
          <StatCard label="Total volume (24h)" value={stats.totalVolume} format={formatCompact} tooltip="Sum of 24h volume across every tracked coin." />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard label="Total market cap" value={stats.totalMarketCap} format={formatCompact} tooltip="Sum of market cap across every tracked coin." />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard label="Tokens tracked" value={stats.tokensTracked} tooltip="Coins in PANDA's live feed right now — not a historical all-time count." />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard label="Active tokens" value={stats.activeTokens} progressPct={activeShare} tooltip="Tokens with at least one real buy or sell in the last hour." />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard label="Graduated" value={stats.graduatedTokens} progressPct={graduatedShare} tooltip="Tokens that moved from Pump.fun's bonding curve to PumpSwap." />
        </motion.div>
      </motion.div>

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        <motion.div variants={fadeUp}>
          <BarChart title="Trading volume by window" data={volumeByWindow} formatValue={formatCompact} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <BarChart title="Launches by recency" data={launchesByAge} />
        </motion.div>
      </motion.div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} variants={fadeUp}>
          <p className="mb-3 text-sm font-medium text-paper/80">Trending tokens</p>
          <div className="overflow-hidden rounded-2xl border border-paper/10">
            {trending.length === 0 ? (
              <p className="bg-ink-raised px-4 py-6 text-center text-sm text-panda-grey">Nothing trending right now.</p>
            ) : (
              trending.slice(0, 8).map((coin) => <TrendingRow key={coin.mint} coin={coin} />)
            )}
          </div>
        </motion.div>

        <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} variants={fadeUp}>
          <p className="mb-3 text-sm font-medium text-paper/80">Creator &amp; protocol fees</p>
          <div className="rounded-2xl border border-paper/10 bg-ink-raised p-6">
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="font-medium">Not tracked yet</p>
                <p className="mt-1 text-sm text-panda-grey">
                  PANDA&apos;s own 1% trade fee is real and on-chain, but we don&apos;t have a fee-tracking store built
                  yet — this card will show real numbers once we do.
                </p>
              </div>
              <Panda pose="empty" size={80} />
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={fadeUp}
        className="mt-6"
      >
        <p className="mb-3 text-sm font-medium text-paper/80">Recent activity</p>
        <ActivityFeed initialEvents={activityEvents} />
      </motion.div>
    </div>
  );
}

function TrendingRow({ coin }: { coin: Coin }) {
  const positive = coin.changePct >= 0;
  return (
    <Link
      href={`/coin/${coin.mint}`}
      className="flex items-center gap-3 border-b border-paper/10 bg-ink-raised px-4 py-3 transition-colors last:border-b-0 hover:bg-paper/5"
    >
      <div
        className="h-8 w-8 shrink-0 overflow-hidden rounded-full"
        style={{ backgroundColor: coin.image ? undefined : coin.bg }}
      >
        <CoinAvatar image={coin.image} ticker={coin.ticker} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">${coin.ticker}</p>
        <p className="truncate text-xs text-panda-grey">{coin.name}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium">{formatCompact(coin.volume24h)}</p>
        <p className={`text-xs ${positive ? "text-bamboo" : "text-clay-red"}`}>{formatPct(coin.changePct)}</p>
      </div>
    </Link>
  );
}
