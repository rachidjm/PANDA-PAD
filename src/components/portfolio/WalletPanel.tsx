"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Doodle from "@/components/doodles/Doodle";
import { getWalletPortfolio, totalPortfolioValueUsd } from "@/lib/solana/portfolio";
import { Coin, PortfolioHolding } from "@/lib/types";
import { formatUsd, truncateAddress } from "@/lib/format";

type State = "loading" | "ready" | "error";

/** The dropdown body shown under the connected wallet button — a quick real read of what's in the wallet, never PANDA's own data. */
export default function WalletPanel({ publicKey, onDisconnect }: { publicKey: PublicKey; onDisconnect: () => void }) {
  const { connection } = useConnection();
  const [state, setState] = useState<State>("loading");
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setState("loading");
      })
      .then(() => fetch("/api/coins"))
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
        <p className="text-xs text-panda-grey">Portfolio value</p>
        <p className="mt-0.5 font-display text-xl font-bold">
          {state === "loading" ? "…" : total !== null ? formatUsd(total) : "—"}
        </p>
      </div>

      {state === "error" && (
        <p className="rounded-xl bg-paper/5 px-3 py-2.5 text-xs text-panda-grey">
          Couldn&apos;t read your wallet right now — try again in a moment.
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
            <p className="rounded-xl bg-paper/5 px-3 py-2.5 text-xs text-panda-grey">No balances found in this wallet.</p>
          ) : (
            top.map((h) => (
              <div key={h.mint} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  {h.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.image} alt="" className="h-full w-full object-cover" />
                  ) : h.doodle ? (
                    <Doodle kind={h.doodle} className="h-full w-full" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-paper/60">
                      {(h.symbol || "?").slice(0, 2)}
                    </div>
                  )}
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
          Open Portfolio
        </Link>
        <button
          onClick={onDisconnect}
          className="w-full rounded-xl px-3 py-2 text-left text-sm text-paper/70 hover:bg-paper/10 hover:text-paper transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function formatAmount(amount: number) {
  if (amount >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
