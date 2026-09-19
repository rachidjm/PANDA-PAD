"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";
import CoinAvatar from "@/components/CoinAvatar";
import { getWalletPortfolio, totalPortfolioValueUsd } from "@/lib/solana/portfolio";
import { Coin, PortfolioHolding } from "@/lib/types";
import { Position } from "@/lib/portfolio/positions";
import { formatPct, formatUsd, truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type State = "loading" | "ready" | "error";
type PositionsState = "loading" | "ready" | "error";
type SortMode = "recent" | "profit";

export default function PortfolioClient({ coins }: { coins: Coin[] }) {
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const { t } = useLanguage();
  const [state, setState] = useState<State>("loading");
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [positionsState, setPositionsState] = useState<PositionsState>("loading");
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [positionsTab, setPositionsTab] = useState<"open" | "closed">("open");
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setPositionsState("loading");
      })
      .then(() => fetch(`/api/portfolio/positions?wallet=${publicKey.toBase58()}`))
      .then((r) => r.json())
      .then((data: { open?: Position[]; closed?: Position[] }) => {
        if (cancelled) return;
        setOpenPositions(data.open || []);
        setClosedPositions(data.closed || []);
        setPositionsState("ready");
      })
      .catch(() => {
        if (!cancelled) setPositionsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey]);

  const sortedPositions = useMemo(() => {
    const list = positionsTab === "open" ? openPositions : closedPositions;
    return [...list].sort((a, b) => (sortMode === "recent" ? b.lastTradeTs - a.lastTradeTs : b.pnlUsd - a.pnlUsd));
  }, [positionsTab, openPositions, closedPositions, sortMode]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setState("loading");
      })
      .then(() => getWalletPortfolio(connection, publicKey, coins))
      .then((h) => {
        if (cancelled) return;
        setHoldings(h);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, coins]);

  if (!connected || !publicKey) {
    return (
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h1 className="font-display text-xl font-bold">{t("pf.title")}</h1>
            <p className="mt-1 text-sm text-panda-grey">{t("pf.connectPrompt")}</p>
          </div>
          <Panda pose="empty" size={80} />
        </div>
      </div>
    );
  }

  const total = totalPortfolioValueUsd(holdings);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("pf.title")}</h1>
          <p className="mt-1 text-sm text-panda-grey">{t("pf.subtitle", { addr: truncateAddress(publicKey.toBase58()) })}</p>
        </div>
        <Panda pose={state === "ready" ? "success" : "idle"} size={72} />
      </div>

      <div className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-xs text-panda-grey">{t("pf.totalValue")}</p>
        <p className="mt-1 font-display text-3xl font-bold">
          {state === "loading" ? "…" : total !== null ? formatUsd(total) : "—"}
        </p>
        {state === "loading" && <p className="mt-2 text-xs text-panda-grey">{t("pf.reading")}</p>}
        {state === "error" && <p className="mt-2 text-xs text-clay-red">{t("pf.readError")}</p>}
        {total === null && state === "ready" && (
          <p className="mt-2 text-xs text-panda-grey">{t("pf.noPriced")}</p>
        )}
      </div>

      {state === "ready" && (
        <div className="mt-4 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
          {holdings.length === 0 ? (
            <p className="p-6 text-center text-sm text-panda-grey">{t("pf.noBalances")}</p>
          ) : (
            holdings.map((h) => (
              <div key={h.mint} className="flex items-center gap-3 p-4">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={h.image} ticker={h.symbol || "?"} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{h.symbol ? `$${h.symbol}` : truncateAddress(h.mint)}</p>
                  <p className="text-xs text-panda-grey">
                    {h.amount.toLocaleString(undefined, { maximumFractionDigits: h.amount >= 1000 ? 0 : 4 })}
                    {h.symbol ? ` $${h.symbol}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">{h.valueUsd !== undefined ? formatUsd(h.valueUsd) : "—"}</p>
                  {h.changePct !== undefined && (
                    <p className={`text-xs ${h.changePct >= 0 ? "text-bamboo" : "text-clay-red"}`}>{formatPct(h.changePct)}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1.5 rounded-full bg-ink-raised p-1">
            <button
              onClick={() => setPositionsTab("open")}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                positionsTab === "open" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
              }`}
            >
              {t("pf.tabOpen")}
            </button>
            <button
              onClick={() => setPositionsTab("closed")}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                positionsTab === "closed" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
              }`}
            >
              {t("pf.tabClosed")}
            </button>
          </div>
          <div className="flex gap-1.5 text-xs">
            <button
              onClick={() => setSortMode("recent")}
              className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                sortMode === "recent" ? "bg-paper/10 text-paper" : "text-panda-grey hover:text-paper"
              }`}
            >
              {t("pf.sortRecent")}
            </button>
            <button
              onClick={() => setSortMode("profit")}
              className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                sortMode === "profit" ? "bg-paper/10 text-paper" : "text-panda-grey hover:text-paper"
              }`}
            >
              {t("pf.sortProfit")}
            </button>
          </div>
        </div>

        <div className="mt-4 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
          {positionsState === "loading" && (
            <div className="space-y-1.5 p-4">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-paper/5" />
              ))}
            </div>
          )}
          {positionsState === "error" && (
            <p className="p-6 text-center text-sm text-clay-red">{t("pf.tradesError")}</p>
          )}
          {positionsState === "ready" && sortedPositions.length === 0 && (
            <p className="p-6 text-center text-sm text-panda-grey">
              {positionsTab === "open"
                ? t("pf.emptyOpen")
                : t("pf.emptyClosed")}
            </p>
          )}
          {positionsState === "ready" &&
            sortedPositions.map((p) => (
              <div key={p.mint} className="flex items-center gap-3 p-4">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={p.coinImage} ticker={p.ticker} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">${p.ticker}</p>
                  <p className="text-xs text-panda-grey">
                    {positionsTab === "open"
                      ? t("pf.heldAvg", { amount: p.remainingTokens.toLocaleString(undefined, { maximumFractionDigits: 2 }), avg: formatUsd(p.avgCostUsd) })
                      : t("pf.fullyClosed")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-medium ${p.pnlUsd >= 0 ? "text-bamboo" : "text-clay-red"}`}>
                    {p.pnlUsd >= 0 ? "+" : ""}
                    {formatUsd(p.pnlUsd)}
                  </p>
                  <p className={`text-xs ${p.pnlUsd >= 0 ? "text-bamboo" : "text-clay-red"}`}>{formatPct(p.pnlPct)}</p>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
