"use client";

import { useState } from "react";
import { Coin, Trade } from "@/lib/types";
import { formatCompact, formatNumber, formatPct } from "@/lib/format";
import CoinAvatar from "@/components/CoinAvatar";
import CoinAge from "@/components/CoinAge";
import Panda from "@/components/panda/Panda";
import LiveBadge from "@/components/LiveBadge";
import TradingPanel from "@/components/coin/TradingPanel";
import StopLossTakeProfit from "@/components/coin/StopLossTakeProfit";
import PriceChart from "@/components/coin/PriceChart";
import { dexLabel } from "@/lib/dex-labels";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";

const tabs = ["Trades", "Holders", "Rewards"] as const;
type Tab = (typeof tabs)[number];
const tabKeys: Record<Tab, DictKey> = { Trades: "coin.tab.trades", Holders: "coin.tab.holders", Rewards: "coin.tab.rewards" };

type Props = {
  coin: Coin;
  trades: Trade[];
  live: boolean;
  tradesLive: boolean;
};

export default function CoinClient({ coin, trades, live, tradesLive }: Props) {
  const [tab, setTab] = useState<Tab>("Trades");
  const { t } = useLanguage();
  const positive = coin.changePct >= 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-paper/10 bg-[#171512]">
                <CoinAvatar image={coin.image} ticker={coin.ticker} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl font-bold">${coin.ticker}</h1>
                  <LiveBadge live={live} />
                  <CoinAge createdAt={coin.createdAt} source={coin.source} verified={coin.launchVerified} className="rounded-full bg-paper/10 px-2.5 py-1 text-xs font-medium text-paper/70" />
                </div>
                <p className="text-sm text-panda-grey">{coin.name}</p>
                <SocialLinks coin={coin} />
              </div>
            </div>
            <Panda pose={positive ? "tradeUp" : "tradeDown"} size={56} />
          </div>

          {coin.description && <p className="mt-4 max-w-xl text-sm leading-relaxed text-paper/75">{coin.description}</p>}

          <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-sm">
            <Stat label={t("coin.marketCap")} value={formatCompact(coin.marketCap)} />
            <Stat label={t("coin.volume24h")} value={formatCompact(coin.volume24h)} />
          </div>

          <div className="mt-6">
            <PriceChart
              poolAddress={coin.poolAddress}
              initialCloses={coin.priceHistory}
              changePct={coin.changePct}
              marketCap={coin.marketCap}
              coin={coin}
            />
          </div>

          <div className="mt-8 flex gap-1 border-b border-paper/10">
            {tabs.map((tb) => (
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
            {tab === "Rewards" && <RewardsTab coin={coin} />}
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <TradingPanel coin={coin} />
          <StopLossTakeProfit coin={coin} />
          <MarketActivityCard coin={coin} />
          <PoolInfoCard coin={coin} />
        </div>
      </div>
    </div>
  );
}

function SocialLinks({ coin }: { coin: Coin }) {
  const { t } = useLanguage();
  if (!coin.website && !coin.twitter && !coin.telegram) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {coin.website && <SocialLink href={coin.website} label={t("coin.website")} />}
      {coin.twitter && <SocialLink href={`https://x.com/${coin.twitter}`} label="X" />}
      {coin.telegram && <SocialLink href={`https://t.me/${coin.telegram}`} label="Telegram" />}
    </div>
  );
}

function SocialLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-full border border-paper/15 px-2.5 py-0.5 text-xs font-medium text-paper/70 hover:border-paper/35 hover:text-paper transition-colors"
    >
      {label}
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-raised px-3.5 py-3">
      <p className="text-xs text-panda-grey">{label}</p>
      <p className="mt-0.5 font-display text-base font-bold">{value}</p>
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
  const { t } = useLanguage();
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-raised p-6">
      <p className="text-sm text-paper/80">{t("coin.rewardsTab.blurb", { ticker: coin.ticker })}</p>
      <a href="/rewards" className="mt-3 inline-block text-sm font-semibold text-meme-orange hover:brightness-110">
        {t("coin.rewardsTab.link")}
      </a>
    </div>
  );
}
