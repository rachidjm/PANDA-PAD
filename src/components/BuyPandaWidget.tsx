"use client";

import { useEffect, useState } from "react";
import { confirmSignature } from "@/lib/solana/confirm";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getJupiterQuote, SOL_MINT } from "@/lib/jupiter/client";
import { base64ToVersionedTransaction } from "@/lib/pump/wire";
import { DEFAULT_SLIPPAGE_PCT } from "@/lib/pump/constants";

const PANDA_MINT = process.env.NEXT_PUBLIC_PANDA_TOKEN_MINT || null;
const presets = [0.1, 0.5, 1];

type Status = "idle" | "quoting" | "building" | "signing" | "confirming" | "done" | "error";

/** Buys $PANDA the same way TradingPanel buys any non-Pump.fun coin — real Jupiter-routed swap, no PANDA custody. */
export default function BuyPandaWidget() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [decimals, setDecimals] = useState(6);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");

  useEffect(() => {
    if (!PANDA_MINT) return;
    connection
      .getTokenSupply(new PublicKey(PANDA_MINT))
      .then((res) => setDecimals(res.value.decimals))
      .catch(() => {});
  }, [connection]);

  // Live estimate as the user types — debounced, so it doesn't hammer Jupiter's quote endpoint on every keystroke.
  useEffect(() => {
    if (!PANDA_MINT) return;
    const sol = parseFloat(amount);
    const timer = setTimeout(() => {
      if (!sol || sol <= 0) {
        setEstimate(null);
        return;
      }
      setStatus("quoting");
      getJupiterQuote({
        inputMint: SOL_MINT,
        outputMint: PANDA_MINT,
        amount: String(Math.round(sol * 1e9)),
        slippageBps: Math.round(DEFAULT_SLIPPAGE_PCT * 100),
      })
        .then((quote) => setEstimate(Number(quote.outAmount) / 10 ** decimals))
        .catch(() => setEstimate(null))
        .finally(() => setStatus("idle"));
    }, 400);
    return () => clearTimeout(timer);
  }, [amount, decimals]);

  if (!PANDA_MINT) {
    return (
      <div className="rounded-full border border-paper/15 px-4 py-2 text-right">
        <p className="text-xs font-medium">Hasn&apos;t launched yet</p>
      </div>
    );
  }

  async function submit() {
    if (!connected || !publicKey || !amount) return;
    setError("");
    setSignature("");
    try {
      setStatus("building");
      const res = await fetch("/api/jupiter/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: PANDA_MINT, user: publicKey.toBase58(), side: "buy", solAmount: parseFloat(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to build transaction.");

      const tx = base64ToVersionedTransaction(data.transaction);

      setStatus("signing");
      const sig = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });

      setStatus("confirming");
      await confirmSignature(connection, sig);

      setSignature(sig);
      setStatus("done");

      // Best-effort — same real trade-history logging TradingPanel does.
      fetch("/api/portfolio/record-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), mint: PANDA_MINT, ticker: "PANDA", side: "buy", signature: sig }),
      }).catch(() => {});
    } catch (err) {
      setStatus("error");
      setError(explainError(err));
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink transition hover:brightness-90"
      >
        Buy $PANDA
      </button>
    );
  }

  const busy = status === "building" || status === "signing" || status === "confirming";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-paper/15 bg-ink-raised p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Buy $PANDA</p>
        <button onClick={() => setOpen(false)} className="text-panda-grey hover:text-paper transition-colors" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-xs text-panda-grey">You pay</span>
        <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink px-4 py-3 focus-within:border-bamboo/50">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            disabled={busy}
            className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-panda-grey/50 disabled:opacity-50"
          />
          <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">SOL</span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(String(p))}
              disabled={busy}
              className="rounded-lg bg-paper/5 px-2.5 py-1 text-xs font-semibold text-paper/70 hover:bg-paper/10 hover:text-paper disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2">
        <span className="mb-1 block text-xs text-panda-grey">You receive (estimated)</span>
        <div className="rounded-2xl bg-ink px-4 py-3 text-lg font-medium">
          {estimate !== null ? `~${estimate.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}{" "}
          <span className="text-xs font-semibold text-paper/60">$PANDA</span>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!connected || !amount || busy}
        className="mt-3 w-full rounded-xl bg-bamboo py-3 text-sm font-bold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!connected
          ? "Connect wallet to buy"
          : status === "building"
          ? "Preparing transaction…"
          : status === "signing"
          ? "Confirm in wallet…"
          : status === "confirming"
          ? "Confirming on Solana…"
          : status === "done"
          ? "Bought!"
          : "Buy $PANDA"}
      </button>

      {status === "error" && error && <p className="mt-2 text-center text-xs text-clay-red">{error}</p>}
      {status === "done" && signature && (
        <a
          href={`https://solscan.io/tx/${signature}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center text-xs text-bamboo hover:underline"
        >
          View transaction
        </a>
      )}
      <p className="mt-2 text-center text-xs text-panda-grey">Routed via Jupiter. PANDA never holds your funds.</p>
    </div>
  );
}

function explainError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/reject|cancel/i.test(message)) return "You rejected the transaction.";
  if (/insufficient/i.test(message)) return "Insufficient SOL to cover this trade plus fees.";
  if (/no route/i.test(message)) return "No trading route found right now — try again shortly.";
  if (/blockhash|expired/i.test(message)) return "Transaction expired — try again.";
  if (/429|too many requests/i.test(message)) return "The Solana RPC is rate-limiting us — wait a moment and retry.";
  return "Trade failed. Please try again.";
}
