"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Coin } from "@/lib/types";

const buyPresets = [0.1, 0.5, 1];
const sellPresets = [25, 50, 100];

export default function TradingPanel({ coin }: { coin: Coin }) {
  const quote = coin.quoteSymbol || "SOL";
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");

  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    connection
      .getBalance(publicKey)
      .then((lamports) => {
        if (!cancelled) setSolBalance(lamports / LAMPORTS_PER_SOL);
      })
      .catch(() => {
        if (!cancelled) setSolBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection]);

  // Real on-chain balance of this specific token, used for the Sell % presets.
  useEffect(() => {
    if (!connected || !publicKey || coin.source === "mock") return;
    let cancelled = false;
    connection
      .getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(coin.mint) })
      .then((res) => {
        if (cancelled) return;
        const uiAmount = res.value[0]?.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        setTokenBalance(uiAmount);
      })
      .catch(() => {
        if (!cancelled) setTokenBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, coin.mint, coin.source]);

  const displaySol = connected ? solBalance : null;
  const displayTokens = connected ? tokenBalance : null;

  function submit() {
    if (!connected || !amount) return;
    setStatus("pending");
    setTimeout(() => {
      setStatus("done");
      setTimeout(() => {
        setStatus("idle");
        setAmount("");
      }, 1800);
    }, 900);
  }

  return (
    <div className="rounded-[22px] border border-paper/10 bg-ink-raised p-4">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => setSide("buy")}
          className={`rounded-xl py-2.5 text-sm font-bold transition-all ${
            side === "buy"
              ? "bg-bamboo text-ink shadow-[0_0_0_1px_rgba(201,217,76,0.4)]"
              : "bg-ink text-panda-grey hover:text-paper"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`rounded-xl py-2.5 text-sm font-bold transition-all ${
            side === "sell"
              ? "bg-clay-red text-ink shadow-[0_0_0_1px_rgba(232,84,62,0.4)]"
              : "bg-ink text-panda-grey hover:text-paper"
          }`}
        >
          Sell
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-panda-grey">{side === "buy" ? "SOL balance" : `${coin.ticker} balance`}</span>
        <span className="font-medium">
          {side === "buy"
            ? displaySol !== null
              ? `${displaySol.toFixed(2)} SOL`
              : "—"
            : displayTokens !== null
            ? `${displayTokens.toLocaleString()} $${coin.ticker}`
            : "—"}
        </span>
      </div>

      {side === "buy" ? (
        <div className="mt-2">
          <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink px-4 py-3.5 focus-within:border-bamboo/50">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0"
              inputMode="decimal"
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey/50"
            />
            <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">{quote}</span>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {buyPresets.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(String(p))}
                className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                  amount === String(p) ? "bg-bamboo/15 text-bamboo" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => displaySol !== null && setAmount(displaySol.toFixed(2))}
              className="rounded-xl bg-paper/5 py-2 text-xs font-semibold text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
            >
              Max
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink px-4 py-3.5 focus-within:border-clay-red/50">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              inputMode="decimal"
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey/50"
            />
            <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">${coin.ticker}</span>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {sellPresets.map((pct) => (
              <button
                key={pct}
                onClick={() => displayTokens !== null && setAmount(String(Math.floor((displayTokens * pct) / 100)))}
                className="rounded-xl bg-paper/5 py-2 text-xs font-semibold text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!connected || !amount || status !== "idle"}
        className={`mt-3 w-full rounded-xl py-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          side === "buy" ? "bg-bamboo text-ink hover:brightness-110" : "bg-clay-red text-ink hover:brightness-110"
        }`}
      >
        {!connected
          ? "Connect wallet to trade"
          : status === "pending"
          ? "Confirm in wallet…"
          : status === "done"
          ? "Done"
          : `${side === "buy" ? "Buy" : "Sell"} $${coin.ticker}`}
      </button>

      <p className="mt-3 text-center text-xs text-panda-grey">
        Simulated trade — live trading goes on-chain with our Pump.fun integration.
      </p>
    </div>
  );
}
