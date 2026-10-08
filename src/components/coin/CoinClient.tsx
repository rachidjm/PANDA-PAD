"use client";

import RugBadge from "@/components/RugBadge";
import CopyCa from "@/components/CopyCa";
import { useEffect, useState } from "react";
import { capturePandaLaunchReferral } from "@/lib/referrals/client";
import { Coin, Trade } from "@/lib/types";
import { formatCompact, formatNumber, formatPct } from "@/lib/format";
import CoinAvatar from "@/components/CoinAvatar";
import Panda from "@/components/panda/Panda";
import Tooltip from "@/components/Tooltip";
import TradingPanel from "@/components/coin/TradingPanel";
import StopLossTakeProfit from "@/components/coin/StopLossTakeProfit";
import PriceChart from "@/components/coin/PriceChart";
import FeeLockNotice from "@/components/coin/FeeLockNotice";
import ShareCoinPrompt from "@/components/coin/ShareCoinPrompt";
import { dexLabel } from "@/lib/dex-labels";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";
import { useFeatures } from "@/components/providers/FeaturesProvider";

const PANDA_MINT = process.env.NEXT_PUBLIC_PANDA_TOKEN_MINT || null;

const tabs = ["Trades", "Holders", "Rewards"] as const;
type Tab = (typeof tabs)[number];
const tabKeys: Record<Tab, DictKey> = { Trades: "coin.tab.trades", Holders: "coin.tab.holders", Rewards: "coin.tab.rewards" };

type Props = {
  coin: Coin;
  trades: Trade[];
  live: boolean;
  tradesLive: boolean;
  /** Real holder count from Helius (src/lib/pump/holders-count.ts) — null when it couldn't be read (never shown as a fake 0). */
  holderCount: number | null;
};

export default function CoinClient({ coin, trades, live, tradesLive, holderCount }: Props) {
  const [tab, setTab] = useState<Tab>("Trades");
  const { t } = useLanguage();
  const { strategies, holderRewards } = useFeatures(); // Draw Your Trade and Stop Loss / Take Profit are custodial: only when switched on
  const positive = coin.changePct >= 0;

  // A PANDA-launched coin's own page doubles as its creator's recruiter link — same first-wins rule as
  // an explicit ?ref= link (src/lib/referrals/client.ts), captured once this page is actually visited.
  useEffect(() => {
    if (coin.launchedOnPanda && coin.creator) capturePandaLaunchReferral(coin.creator);
  }, [coin.launchedOnPanda, coin.creator]);

  const stats: { label: string; value: string }[] = [
    { label: t("coin.marketCap"), value: formatCompact(coin.marketCap) },
    { label: t("coin.volume24h"), value: formatCompact(coin.volume24h) },
    ...(coin.liquidityUsd ? [{ label: t("coin.liquidity"), value: formatCompact(coin.liquidityUsd) }] : []),
    { label: t("coin.holders"), value: holderCount !== null ? formatNumber(holderCount) : "—" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 py-4 sm:py-8">
      {/* On a phone the order is: coin and chart, then buy/sell, then the trades/holders/rewards tabs, then market and pool info — the
          buy/sell box is one of the first things to see. On a desktop it is the same two columns as always (the right column sticks). */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="order-1 lg:order-none lg:col-start-1 lg:row-start-1">
          {/* One main line: logo, $TICKER, name in grey, a small status dot with its own tooltip — not a big pill. */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-paper/10 bg-[#171512]">
                <CoinAvatar image={coin.image} ticker={coin.ticker} mint={coin.mint} />
              </div>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <h1 className="font-display text-xl font-bold sm:text-2xl">${coin.ticker}</h1>
                <span className="truncate text-sm text-panda-grey">{coin.name}</span>
                {PANDA_MINT && coin.mint === PANDA_MINT && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-bamboo/40 bg-bamboo/15 px-2 py-0.5 text-[11px] font-bold text-bamboo">
                    {t("panda.officialToken")}
                  </span>
                )}
                <CoinStatusDot coin={coin} />
              </div>
            </div>
            <Panda pose={positive ? "tradeUp" : "tradeDown"} size={48} />
          </div>

          {/* One row of same-size action icons: copy CA, website, X, Telegram — then the compact RugCheck pill. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CopyCa mint={coin.mint} variant="action" />
            {coin.website && <IconLink href={coin.website} label={t("coin.website")} icon="globe" />}
            {coin.twitter && <IconLink href={`https://x.com/${coin.twitter}`} label="X" icon="x" />}
            {coin.telegram && <IconLink href={`https://t.me/${coin.telegram}`} label="Telegram" icon="telegram" />}
            <RugBadge mint={coin.mint} variant="pill" className="ml-1" />
            {coin.launchedOnPanda && (
              <span className="inline-flex items-center gap-1 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">
                <span aria-hidden>🐼</span>
                {t("coinCard.launchedOnPanda")}
              </span>
            )}
            {!live && <span className="text-xs text-panda-grey">{t("live.demo")}</span>}
          </div>

          <FeeLockNotice mint={coin.mint} />
          <ShareCoinPrompt creator={coin.creator} />

          {coin.quality === "suspect" && (
            <div className="mt-4 rounded-2xl border border-clay-red/40 bg-clay-red/10 px-4 py-3 text-xs leading-relaxed text-paper/90" role="alert">
              <p className="font-semibold text-clay-red">{t("quality.suspect.title")}</p>
              <p className="mt-1">{t("quality.suspect.body")}</p>
            </div>
          )}

          {coin.description && <ClampedDescription text={coin.description} />}

          {/* Stats in one row, no boxes — thin dividing lines, small grey label over the value. */}
          {stats.length > 0 && (
            <div className="mt-4 flex flex-wrap divide-x divide-paper/10 border-t border-paper/10 pt-4 sm:mt-5 sm:pt-5">
              {stats.map((s, i) => (
                <div key={s.label} className={`pr-5 ${i === 0 ? "" : "pl-5"}`}>
                  <p className="text-[11px] text-panda-grey">{s.label}</p>
                  <p className="mt-0.5 font-display text-sm font-bold tabular-nums sm:text-base">{s.value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 sm:mt-6">
            <PriceChart
              poolAddress={coin.poolAddress}
              initialCloses={coin.priceHistory}
              changePct={coin.changePct}
              marketCap={coin.marketCap}
              coin={strategies ? coin : undefined}
            />
          </div>
        </div>

        <div className="contents lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block lg:space-y-4 lg:self-start">
          <div className="order-2 space-y-4 lg:order-none">
            <TradingPanel coin={coin} />
            {strategies && <StopLossTakeProfit coin={coin} />}
          </div>
          <div className="order-4 space-y-4 lg:order-none">
            <MarketActivityCard coin={coin} />
            <PoolInfoCard coin={coin} />
          </div>
        </div>

        <div className="order-3 lg:order-none lg:col-start-1 lg:row-start-2">
          <div className="mt-2 flex gap-1 border-b border-paper/10 lg:mt-3">
            {tabs.filter((tb) => tb !== "Rewards" || holderRewards).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === tb ? "border-b-2 border-meme-orange text-paper" : "text-paper/50 hover:text-paper/80"
                }`}
              >
                {t(tabKeys[tb])}
              </button>
            ))}
          </div>

          <div className="py-6">
            {tab === "Trades" && <TradesTab trades={trades} coin={coin} live={tradesLive} />}
            {tab === "Holders" && <HoldersTab />}
            {tab === "Rewards" && holderRewards && <RewardsTab coin={coin} />}
          </div>
        
        </div>
      </div>
    </div>

  );
}

/** A small colored dot with a tooltip — replaces the old big "Live"/"Graduated" pill. Only pump-fun
 *  (still on the bonding curve) and pumpswap (graduated) coins have a meaningful status; a coin from
 *  any other dex has neither, so nothing renders. */
function CoinStatusDot({ coin }: { coin: Coin }) {
  const { t } = useLanguage();
  if (coin.source !== "pump-fun" && coin.source !== "pumpswap") return null;
  const graduated = coin.source === "pumpswap";
  const label = graduated ? t("coin.status.graduated") : t("coin.status.live");
  return (
    <Tooltip label={label}>
      <span className={`h-2 w-2 rounded-full ${graduated ? "bg-meme-orange" : "bg-bamboo"}`} aria-label={label} />
    </Tooltip>
  );
}

const ICONS: Record<"globe" | "x" | "telegram", React.ReactNode> = {
  globe: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.75 5.5 3.75 9S14.5 18.5 12 21c-2.5-2.5-3.75-5.5-3.75-9S9.5 5.5 12 3Z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
      <path d="M18.3 2H21l-6.6 7.5L22.2 22h-6.8l-5.3-6.9L3.9 22H1.2l7.1-8.1L1 2h6.9l4.8 6.3L18.3 2Zm-1.2 18h1.5L7 3.9H5.4L17.1 20Z" />
    </svg>
  ),
  telegram: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
      <path d="M21.5 3.5 2.7 11c-1 .4-1 1.9.1 2.2l4.6 1.4 1.8 5.5c.3.9 1.5 1.1 2.1.3l2.6-3.2 4.7 3.5c.9.6 2.1.1 2.3-.9l3-14.7c.2-1.1-.9-2-2-1.6ZM8.6 14.1l9.1-6.9c.3-.2.6.1.3.4l-7.5 7.7-.3 3.4-1.6-4.6Z" />
    </svg>
  ),
};

function IconLink({ href, label, icon }: { href: string; label: string; icon: keyof typeof ICONS }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-paper/15 text-paper/70 transition-colors hover:border-paper/35 hover:text-paper"
    >
      {ICONS[icon]}
    </a>
  );
}

/** Clamped to 2 lines with a "Read more" button that removes the clamp — never toggles back, so the
 *  layout doesn't jump once someone's actually reading it. */
function ClampedDescription({ text }: { text: string }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3 max-w-xl sm:mt-4">
      <p className={`text-sm leading-relaxed text-paper/75 ${expanded ? "" : "line-clamp-2"}`}>{text}</p>
      {!expanded && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-xs font-semibold text-meme-orange hover:brightness-110">
          {t("coin.readMore")}
        </button>
      )}
    </div>
  );
}

const activityLabels: Record<"m5" | "h1" | "h24", string> = { m5: "5m", h1: "1h", h24: "24h" };

function MarketActivityCard({ coin }: { coin: Coin }) {
  const { t } = useLanguage();
  const windows = (Object.keys(activityLabels) as (keyof typeof activityLabels)[]).filter(
    (w) => coin.activity?.[w] || coin.changeWindows?.[w] !== undefined
  );
  const [win, setWin] = useState<"m5" | "h1" | "h24">(windows.includes("h1") ? "h1" : windows[0] ?? "h24");
  if (windows.length === 0) return null;

  const change = coin.changeWindows?.[win];
  const volume = coin.volumeWindows?.[win];
  const activity = coin.activity?.[win];
  const totalTx = activity ? activity.buys + activity.sells : 0;
  const buyShare = totalTx ? (activity!.buys / totalTx) * 100 : 50;

  return (
    <div className="rounded-[22px] border border-paper/10 bg-ink-raised p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-paper/80">{t("coin.activity.title")}</p>
        <div className="flex gap-1 rounded-full bg-ink p-0.5">
          {windows.map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                win === w ? "bg-paper/15 text-paper" : "text-panda-grey hover:text-paper/80"
              }`}
            >
              {activityLabels[w]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {change !== undefined && (
          <div>
            <p className="text-xs text-panda-grey">{t("coin.activity.priceChange")}</p>
            <p className={`font-medium ${change >= 0 ? "text-bamboo" : "text-clay-red"}`}>{formatPct(change)}</p>
          </div>
        )}
        {volume !== undefined && (
          <div>
            <p className="text-xs text-panda-grey">{t("coin.activity.volume")}</p>
            <p className="font-medium">{formatCompact(volume)}</p>
          </div>
        )}
      </div>

      {activity && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-bamboo">
              {activity.buys} {t("coin.activity.buys")}
            </span>
            <span className="text-clay-red">
              {activity.sells} {t("coin.activity.sells")}
            </span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full">
            <div className="bg-bamboo" style={{ width: `${buyShare}%` }} />
            <div className="flex-1 bg-clay-red" />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-panda-grey">
            <span>
              {activity.buyers} {t("coin.activity.buyers")}
            </span>
            <span>
              {activity.sellers} {t("coin.activity.sellers")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function PoolInfoCard({ coin }: { coin: Coin }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-[22px] border border-paper/10 bg-ink-raised p-5">
      <p className="text-sm font-medium text-paper/80">{t("coin.pool.title")}</p>
      <div className="mt-3 space-y-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-panda-grey">{t("coin.pool.pairedWith")}</span>
          <span className="font-medium">{coin.quoteSymbol || "SOL"}</span>
        </div>
        {!!coin.liquidityUsd && (
          <div className="flex items-center justify-between">
            <span className="text-panda-grey">{t("coin.pool.liquidity")}</span>
            <span className="font-medium">{formatCompact(coin.liquidityUsd)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-panda-grey">{t("coin.pool.source")}</span>
          <span className="font-medium">
            {coin.source === "pump-fun"
              ? t("coin.pool.sourcePumpFun")
              : coin.source === "pumpswap"
              ? t("coin.pool.sourcePumpSwap")
              : dexLabel(coin.dex)}
          </span>
        </div>
      </div>
    </div>
  );
}

function TradesTab({ trades, coin, live }: { trades: Trade[]; coin: Coin; live: boolean }) {
  const { t } = useLanguage();
  const quote = coin.quoteSymbol || "SOL";
  return (
    <div>
      {trades.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-paper/10 bg-ink-raised py-14 text-center">
          <Panda pose="empty" size={110} />
          <p className="text-sm text-paper/80">{t("coin.trades.emptyTitle")}</p>
          <p className="max-w-xs text-xs text-panda-grey">
            {live ? t("coin.trades.emptyLive") : t("coin.trades.emptyDown")}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-paper/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-paper/10 text-left text-xs text-panda-grey">
                <th className="px-4 py-2.5 font-medium">{t("coin.trades.side")}</th>
                <th className="px-4 py-2.5 font-medium">{t("coin.trades.trader")}</th>
                <th className="px-4 py-2.5 font-medium">{quote}</th>
                <th className="px-4 py-2.5 font-medium">{t("coin.trades.tokens")}</th>
                <th className="px-4 py-2.5 font-medium">{t("coin.trades.time")}</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((tr) => (
                <tr key={tr.id} className="border-b border-paper/5 last:border-0">
                  <td className={`px-4 py-2.5 font-medium ${tr.side === "buy" ? "text-bamboo" : "text-clay-red"}`}>
                    {tr.side === "buy" ? t("coin.trades.buy") : t("coin.trades.sell")}
                  </td>
                  <td className="px-4 py-2.5 text-paper/80">
                    {tr.txHash ? (
                      <a
                        href={`https://solscan.io/tx/${tr.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-paper hover:underline"
                      >
                        {tr.trader}
                      </a>
                    ) : (
                      tr.trader
                    )}
                  </td>
                  <td className="px-4 py-2.5">{tr.sol}</td>
                  <td className="px-4 py-2.5">{formatNumber(tr.tokens)}</td>
                  <td className="px-4 py-2.5 text-panda-grey">{tr.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HoldersTab() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-paper/10 bg-ink-raised py-14 text-center">
      <Panda pose="empty" size={110} />
      <p className="text-sm text-paper/80">{t("coin.holders.title")}</p>
      <p className="max-w-xs text-xs text-panda-grey">{t("coin.holders.subtitle")}</p>
    </div>
  );
}

function RewardsTab({ coin }: { coin: Coin }) {
  const { t, lang } = useLanguage();
  const [summary, setSummary] = useState<{ paidTotalLamports: number; lastRun: { finishedAt: number; holdersPaid: number; lamportsPaid: number } | null; lastSignature: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rewards/mint-summary?mint=${coin.mint}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setSummary(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coin.mint]);
  const sol = (lamports: number) => `${(lamports / 1e9).toLocaleString(lang, { maximumFractionDigits: 4 })} SOL`;
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-raised p-6">
      <p className="text-sm text-paper/80">{t("coin.rewardsTab.blurb", { ticker: coin.ticker })}</p>
      {summary && summary.paidTotalLamports > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-ink px-3.5 py-3">
            <p className="text-[11px] text-panda-grey">{t("coin.rewardsTab.paidTotal")}</p>
            <p className="mt-1 font-display text-base font-bold">{sol(summary.paidTotalLamports)}</p>
          </div>
          {summary.lastRun && (
            <div className="rounded-xl bg-ink px-3.5 py-3">
              <p className="text-[11px] text-panda-grey">{t("coin.rewardsTab.lastRun")}</p>
              <p className="mt-1 font-display text-base font-bold">{sol(summary.lastRun.lamportsPaid)}</p>
              <p className="mt-0.5 text-[11px] text-panda-grey">
                {t("coin.rewardsTab.lastRunDetail", { n: summary.lastRun.holdersPaid, date: new Date(summary.lastRun.finishedAt).toLocaleString(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                {summary.lastSignature && (
                  <>
                    {" · "}
                    <a href={`https://solscan.io/tx/${summary.lastSignature}`} target="_blank" rel="noreferrer" className="font-semibold text-bamboo hover:underline">
                      Solscan
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      )}
      <a href="/rewards" className="mt-4 inline-block text-sm font-semibold text-meme-orange hover:brightness-110">
        {t("coin.rewardsTab.link")}
      </a>
    </div>
  );
}
