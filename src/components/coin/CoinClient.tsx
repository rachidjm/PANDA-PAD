"use client";

import { useState } from "react";
import { Coin, Holder, Trade } from "@/lib/types";
import { formatCompact, formatNumber, formatPct, truncateAddress } from "@/lib/format";
import Doodle from "@/components/doodles/Doodle";
import Panda from "@/components/panda/Panda";
import LiveBadge from "@/components/LiveBadge";
import TradingPanel from "@/components/coin/TradingPanel";
import PriceChart from "@/components/coin/PriceChart";

const tabs = ["Trades", "Holders", "Rewards"] as const;
type Tab = (typeof tabs)[number];

type Props = {
  coin: Coin;
  trades: Trade[];
  holders: Holder[];
  live: boolean;
  tradesLive: boolean;
};

export default function CoinClient({ coin, trades, holders, live, tradesLive }: Props) {
  const [tab, setTab] = useState<Tab>("Trades");
  const positive = coin.changePct >= 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div
                className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-paper/10"
                style={{ backgroundColor: coin.image ? "#171512" : coin.bg }}
              >
                {coin.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coin.image} alt={coin.name} className="h-full w-full object-cover" />
                ) : (
                  <Doodle kind={coin.doodle} className="h-full w-full p-1.5" />
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl font-bold">${coin.ticker}</h1>
                  <LiveBadge live={live} />
                </div>
                <p className="text-sm text-panda-grey">{coin.name}</p>
                <SocialLinks coin={coin} />
              </div>
            </div>
            <Panda pose={positive ? "tradeUp" : "tradeDown"} size={56} />
          </div>

          {coin.description && <p className="mt-4 max-w-xl text-sm leading-relaxed text-paper/75">{coin.description}</p>}

          <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-sm">
            <Stat label="Market cap" value={formatCompact(coin.marketCap)} />
            <Stat label="Volume (24h)" value={formatCompact(coin.volume24h)} />
          </div>

          <div className="mt-6">
            <PriceChart poolAddress={coin.poolAddress} initialCloses={coin.priceHistory} changePct={coin.changePct} />
          </div>

          <div className="mt-8 flex gap-1 border-b border-paper/10">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === t ? "border-b-2 border-meme-orange text-paper" : "text-paper/50 hover:text-paper/80"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="py-6">
            {tab === "Trades" && <TradesTab trades={trades} coin={coin} live={tradesLive} />}
            {tab === "Holders" && <HoldersTab holders={holders} coin={coin} />}
            {tab === "Rewards" && <RewardsTab coin={coin} />}
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <TradingPanel coin={coin} />
          <MarketActivityCard coin={coin} />
          <PoolInfoCard coin={coin} />
        </div>
      </div>
    </div>
  );
}

function SocialLinks({ coin }: { coin: Coin }) {
  if (!coin.website && !coin.twitter && !coin.telegram) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {coin.website && <SocialLink href={coin.website} label="Website" />}
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
        <p className="text-sm font-medium text-paper/80">Market activity</p>
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
            <p className="text-xs text-panda-grey">Price change</p>
            <p className={`font-medium ${change >= 0 ? "text-bamboo" : "text-clay-red"}`}>{formatPct(change)}</p>
          </div>
        )}
        {volume !== undefined && (
          <div>
            <p className="text-xs text-panda-grey">Volume</p>
            <p className="font-medium">{formatCompact(volume)}</p>
          </div>
        )}
      </div>

      {activity && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-bamboo">{activity.buys} buys</span>
            <span className="text-clay-red">{activity.sells} sells</span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full">
            <div className="bg-bamboo" style={{ width: `${buyShare}%` }} />
            <div className="flex-1 bg-clay-red" />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-panda-grey">
            <span>{activity.buyers} buyers</span>
            <span>{activity.sellers} sellers</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PoolInfoCard({ coin }: { coin: Coin }) {
  if (coin.source === "mock") return null;
  return (
    <div className="rounded-[22px] border border-paper/10 bg-ink-raised p-5">
      <p className="text-sm font-medium text-paper/80">Pool</p>
      <div className="mt-3 space-y-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-panda-grey">Paired with</span>
          <span className="font-medium">{coin.quoteSymbol || "SOL"}</span>
        </div>
        {!!coin.liquidityUsd && (
          <div className="flex items-center justify-between">
            <span className="text-panda-grey">Liquidity</span>
            <span className="font-medium">{formatCompact(coin.liquidityUsd)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-panda-grey">Source</span>
          <span className="font-medium">{coin.source === "pump-fun" ? "Pump.fun bonding curve" : "PumpSwap (graduated)"}</span>
        </div>
      </div>
    </div>
  );
}

function TradesTab({ trades, coin, live }: { trades: Trade[]; coin: Coin; live: boolean }) {
  const quote = coin.quoteSymbol || "SOL";
  return (
    <div>
      {!live && (
        <p className="mb-3 text-xs text-panda-grey">Demo trades — connect to a real pool for live activity.</p>
      )}
      <div className="overflow-hidden rounded-2xl border border-paper/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper/10 text-left text-xs text-panda-grey">
              <th className="px-4 py-2.5 font-medium">Side</th>
              <th className="px-4 py-2.5 font-medium">Trader</th>
              <th className="px-4 py-2.5 font-medium">{quote}</th>
              <th className="px-4 py-2.5 font-medium">Tokens</th>
              <th className="px-4 py-2.5 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id} className="border-b border-paper/5 last:border-0">
                <td className={`px-4 py-2.5 font-medium ${t.side === "buy" ? "text-bamboo" : "text-clay-red"}`}>
                  {t.side === "buy" ? "Buy" : "Sell"}
                </td>
                <td className="px-4 py-2.5 text-paper/80">
                  {t.txHash ? (
                    <a
                      href={`https://solscan.io/tx/${t.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-paper hover:underline"
                    >
                      {t.trader}
                    </a>
                  ) : (
                    t.trader
                  )}
                </td>
                <td className="px-4 py-2.5">{t.sol}</td>
                <td className="px-4 py-2.5">{formatNumber(t.tokens)}</td>
                <td className="px-4 py-2.5 text-panda-grey">{t.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldersTab({ holders, coin }: { holders: Holder[]; coin: Coin }) {
  if (coin.source !== "mock") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-paper/10 bg-ink-raised py-14 text-center">
        <Panda pose="empty" size={110} />
        <p className="text-sm text-paper/80">Holder data isn&apos;t available yet</p>
        <p className="max-w-xs text-xs text-panda-grey">
          We only have real price and trade data for now — a holder breakdown needs our own indexer, coming soon.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {holders.map((h, i) => (
        <div key={h.address} className="flex items-center gap-3">
          <span className="w-5 text-xs text-panda-grey">{i + 1}</span>
          <span className="w-28 shrink-0 text-sm">{truncateAddress(h.address)}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper/10">
            <div className="h-full rounded-full bg-paper/70" style={{ width: `${Math.min(h.pct, 100)}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right text-sm text-panda-grey">{h.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function RewardsTab({ coin }: { coin: Coin }) {
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-raised p-6">
      <p className="text-sm text-paper/80">
        Every trade of ${coin.ticker} pays a small fee. A share flows back to holders as $PANDA rewards.
      </p>
      <a href="/rewards" className="mt-3 inline-block text-sm font-semibold text-meme-orange hover:brightness-110">
        See how rewards work
      </a>
    </div>
  );
}
