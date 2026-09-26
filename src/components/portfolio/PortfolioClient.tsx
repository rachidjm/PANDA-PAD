"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useReadConnection } from "@/lib/solana/useReadConnection";
import Panda from "@/components/panda/Panda";
import PortfolioView, { LoadState, RewardsInfo } from "./PortfolioView";
import { getWalletPortfolio, portfolioChange24h } from "@/lib/solana/portfolio";
import { Coin, PortfolioHolding } from "@/lib/types";
import { Position } from "@/lib/portfolio/positions";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import { allocation, buildRows, summarize } from "@/lib/portfolio/view";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";

/** Loads what a connected wallet holds (from Solana), what PANDA knows of its trades, and its holder rewards; the page itself is PortfolioView. */
export default function PortfolioClient({ coins }: { coins: Coin[] }) {
  const connection = useReadConnection();
  const { connected, publicKey } = useWallet();
  const { t } = useLanguage();
  const { holderRewards } = useFeatures();
  const address = publicKey?.toBase58() ?? null;

  const [holdingsState, setHoldingsState] = useState<LoadState>("loading");
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [positionsState, setPositionsState] = useState<LoadState>("loading");
  const [open, setOpen] = useState<Position[]>([]);
  const [closed, setClosed] = useState<Position[]>([]);
  const [recent, setRecent] = useState<LoggedTrade[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [rewards, setRewards] = useState<RewardsInfo | "loading" | "error">("loading");

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setPositionsState("loading");
      })
      .then(() => fetch(`/api/portfolio/positions?wallet=${address}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("positions"))))
      .then((data: { open?: Position[]; closed?: Position[]; recent?: LoggedTrade[]; historyError?: boolean }) => {
        if (cancelled) return;
        setHistoryError(!!data.historyError);
        setOpen(data.open || []);
        setClosed(data.closed || []);
        setRecent(data.recent || []);
        setPositionsState("ready");
      })
      .catch(() => {
        if (!cancelled) setPositionsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (!address || !holderRewards) return; // holder rewards are switched off: nothing to read
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setRewards("loading");
      })
      .then(() => fetch(`/api/portfolio/rewards?wallet=${address}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("rewards"))))
      .then((data: RewardsInfo) => {
        if (!cancelled) setRewards(data);
      })
      .catch(() => {
        if (!cancelled) setRewards("error");
      });
    return () => {
      cancelled = true;
    };
  }, [address, holderRewards]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setHoldingsState("loading");
      })
      .then(() => getWalletPortfolio(connection, publicKey, coins))
      .then((h) => {
        if (cancelled) return;
        setHoldings(h);
        setHoldingsState("ready");
      })
      .catch(() => {
        if (!cancelled) setHoldingsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, coins]);

  // Until the trade history has loaded, no P&L may be claimed: treat "no positions yet" as unknown, not as "no trades".
  const change24h = useMemo(() => portfolioChange24h(holdings), [holdings]);
  const rows = useMemo(() => buildRows(holdings, positionsState === "ready" ? open : []), [holdings, open, positionsState]);
  const summary = useMemo(() => summarize(rows, positionsState === "ready" ? [...open, ...closed] : []), [rows, open, closed, positionsState]);
  const alloc = useMemo(() => allocation(rows), [rows]);

  if (!connected || !address) {
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

  return (
    <PortfolioView
      address={address}
      holdingsState={holdingsState}
      change24h={change24h}
      rows={rows}
      summary={summary}
      alloc={alloc}
      positionsState={positionsState}
      closed={closed}
      recent={recent}
      historyError={historyError}
      rewards={rewards}
    />
  );
}
