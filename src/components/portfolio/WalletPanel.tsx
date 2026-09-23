"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReadConnection } from "@/lib/solana/useReadConnection";
import { PublicKey } from "@solana/web3.js";
import CoinAvatar from "@/components/CoinAvatar";
import { getWalletPortfolio, totalPortfolioValueUsd } from "@/lib/solana/portfolio";
import { Coin, PortfolioHolding } from "@/lib/types";
import { formatUsd, truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";

type State = "loading" | "ready" | "error";

/** The dropdown body shown under the connected wallet button — a quick real read of what's in the wallet, never PANDA's own data. */
export default function WalletPanel({ publicKey, onDisconnect }: { publicKey: PublicKey; onDisconnect: () => void }) {
  const connection = useReadConnection();
  const { t } = useLanguage();
  const { points, airdrops } = useFeatures();
  const [state, setState] = useState<State>("loading");
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setState("loading");
      })
      .then(() => fetch("/api/coins?quality=all"))
      .then((r) => r.json())
      .then((data: { coins?: Coin[] }) => getWalletPortfolio(connection, publicKey, data.coins || []))
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
  }, [connection, publicKey]);

  const total = totalPortfolioValueUsd(holdings);
  const top = holdings.slice(0, 4);

  return (
    <div className="w-72 rounded-2xl border border-paper/15 bg-ink-raised p-3 shadow-xl">
      <div className="px-1 pb-2">
        <p className="text-xs text-panda-grey">{t("wp.value")}</p>
        <p className="mt-0.5 font-display text-xl font-bold">
          {state === "loading" ? "…" : total !== null ? formatUsd(total) : "—"}
        </p>
      </div>

      {state === "error" && (
        <p className="rounded-xl bg-paper/5 px-3 py-2.5 text-xs text-panda-grey">
          {t("wp.readError")}
        </p>
      )}

      {state === "loading" && (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-paper/5" />
          ))}
        </div>
      )}

      {state === "ready" && (
        <div className="space-y-0.5">
          {top.length === 0 ? (
            <p className="rounded-xl bg-paper/5 px-3 py-2.5 text-xs text-panda-grey">{t("pf.noBalances")}</p>
          ) : (
            top.map((h) => (
              <div key={h.mint} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={h.image} ticker={h.symbol || "?"} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.symbol ? `$${h.symbol}` : truncateAddress(h.mint)}</p>
                  <p className="text-xs text-panda-grey">{formatAmount(h.amount)}</p>
                </div>
                <p className="shrink-0 text-xs text-paper/70">{h.valueUsd !== undefined ? formatUsd(h.valueUsd) : "—"}</p>
              </div>
            ))
          )}
        </div>
      )}

      <div className="mt-2 space-y-0.5 border-t border-paper/10 pt-2">
        <Link
          href="/portfolio"
          className="block rounded-xl px-3 py-2 text-sm font-semibold text-paper hover:bg-paper/10 transition-colors"
        >
          {t("wp.open")}
        </Link>
        {[
          { href: "/rewards", label: t("nav.rewards"), show: true },
          { href: "/points", label: t("nav.points"), show: points },
          { href: "/airdrops", label: t("nav.airdrops"), show: airdrops },
        ]
          .filter((i) => i.show)
          .map((i) => (
            <Link key={i.href} href={i.href} className="block rounded-xl px-3 py-2 text-sm text-paper/80 hover:bg-paper/10 hover:text-paper transition-colors">
              {i.label}
            </Link>
          ))}
        <button
          onClick={onDisconnect}
          className="w-full rounded-xl px-3 py-2 text-left text-sm text-paper/70 hover:bg-paper/10 hover:text-paper transition-colors"
        >
          {t("wp.disconnect")}
        </button>
      </div>
    </div>
  );
}

function formatAmount(amount: number) {
  if (amount >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
