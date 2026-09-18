"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";
import Doodle from "@/components/doodles/Doodle";
import { getWalletPortfolio, totalPortfolioValueUsd } from "@/lib/solana/portfolio";
import { Coin, PortfolioHolding } from "@/lib/types";
import { formatPct, formatUsd, truncateAddress } from "@/lib/format";

type State = "loading" | "ready" | "error";

export default function PortfolioClient({ coins }: { coins: Coin[] }) {
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const [state, setState] = useState<State>("loading");
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);

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
            <h1 className="font-display text-xl font-bold">Portfolio</h1>
            <p className="mt-1 text-sm text-panda-grey">Connect your wallet to see what you really hold — PANDA never custodies it.</p>
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
          <h1 className="font-display text-2xl font-bold">Portfolio</h1>
          <p className="mt-1 text-sm text-panda-grey">{truncateAddress(publicKey.toBase58())} — read directly from Solana.</p>
        </div>
        <Panda pose={state === "ready" ? "success" : "idle"} size={72} />
      </div>

      <div className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-xs text-panda-grey">Total value</p>
        <p className="mt-1 font-display text-3xl font-bold">
          {state === "loading" ? "…" : total !== null ? formatUsd(total) : "—"}
        </p>
        {state === "loading" && <p className="mt-2 text-xs text-panda-grey">Reading your wallet…</p>}
        {state === "error" && <p className="mt-2 text-xs text-clay-red">Couldn&apos;t read your wallet — try again in a moment.</p>}
        {total === null && state === "ready" && (
          <p className="mt-2 text-xs text-panda-grey">No priced holdings found — balances below may still be real and unpriced.</p>
        )}
      </div>

      {state === "ready" && (
        <div className="mt-4 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
          {holdings.length === 0 ? (
            <p className="p-6 text-center text-sm text-panda-grey">No balances found in this wallet.</p>
          ) : (
            holdings.map((h) => (
              <div key={h.mint} className="flex items-center gap-3 p-4">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  {h.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.image} alt="" className="h-full w-full object-cover" />
                  ) : h.doodle ? (
                    <Doodle kind={h.doodle} className="h-full w-full" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-paper/60">
                      {(h.symbol || "?").slice(0, 2)}
                    </div>
                  )}
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
    </div>
  );
}
