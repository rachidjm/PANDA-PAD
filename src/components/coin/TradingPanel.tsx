"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { Coin } from "@/lib/types";
import { buildBuyTransaction } from "@/lib/pump/buy";
import { buildSellTransaction } from "@/lib/pump/sell";

const buyPresets = [0.1, 0.5, 1];
const sellPresets = [25, 50, 100];

type Status = "idle" | "building" | "signing" | "sending" | "confirming" | "done" | "error";

export default function TradingPanel({ coin }: { coin: Coin }) {
  const quote = coin.quoteSymbol || "SOL";
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState(6);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");

  const graduated = coin.source === "pumpswap";

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
  }, [connected, publicKey, connection, status]);

  // Real on-chain balance of this specific token, used for the Sell % presets.
  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    connection
      .getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(coin.mint) })
      .then((res) => {
        if (cancelled) return;
        const info = res.value[0]?.account.data.parsed?.info?.tokenAmount;
        setTokenBalance(info?.uiAmount ?? 0);
        if (info?.decimals !== undefined) setTokenDecimals(info.decimals);
      })
      .catch(() => {
        if (!cancelled) setTokenBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, coin.mint, status]);

  const displaySol = connected ? solBalance : null;
  const displayTokens = connected ? tokenBalance : null;

  async function submit() {
    if (!connected || !publicKey || !amount || graduated) return;
    setError("");
    setSignature("");
    try {
      setStatus("building");
      const mint = new PublicKey(coin.mint);
      const tx =
        side === "buy"
          ? await buildBuyTransaction({ connection, mint, user: publicKey, solAmount: parseFloat(amount) })
          : await buildSellTransaction({
              connection,
              mint,
              user: publicKey,
              tokenAmount: new BN(Math.round(parseFloat(amount) * 10 ** tokenDecimals)),
            });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = publicKey;
      tx.recentBlockhash = blockhash;

      setStatus("signing");
      const sig = await sendTransaction(tx, connection);

      setStatus("confirming");
      const confirmation = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (confirmation.value.err) throw new Error("Transaction failed to confirm.");

      setSignature(sig);
      setStatus("done");
      setTimeout(() => {
        setStatus("idle");
        setAmount("");
      }, 4000);
    } catch (err) {
      setStatus("error");
      setError(explainError(err));
    }
  }

  const busy = status !== "idle" && status !== "error" && status !== "done";

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
              disabled={busy}
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey/50 disabled:opacity-50"
            />
            <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">{quote}</span>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {buyPresets.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(String(p))}
                disabled={busy}
                className={`rounded-xl py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  amount === String(p) ? "bg-bamboo/15 text-bamboo" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => displaySol !== null && setAmount(Math.max(displaySol - 0.01, 0).toFixed(2))}
              disabled={busy}
              className="rounded-xl bg-paper/5 py-2 text-xs font-semibold text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper disabled:opacity-50"
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
              disabled={busy}
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey/50 disabled:opacity-50"
            />
            <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">${coin.ticker}</span>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {sellPresets.map((pct) => (
              <button
                key={pct}
                onClick={() => displayTokens !== null && setAmount(String(Math.floor((displayTokens * pct) / 100)))}
                disabled={busy}
                className="rounded-xl bg-paper/5 py-2 text-xs font-semibold text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper disabled:opacity-50"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!connected || !amount || busy || graduated}
        className={`mt-3 w-full rounded-xl py-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          side === "buy" ? "bg-bamboo text-ink hover:brightness-110" : "bg-clay-red text-ink hover:brightness-110"
        }`}
      >
        {!connected
          ? "Connect wallet to trade"
          : graduated
          ? "Graduated — PumpSwap trading coming soon"
          : status === "building"
          ? "Preparing transaction…"
          : status === "signing"
          ? "Confirm in wallet…"
          : status === "sending"
          ? "Sending…"
          : status === "confirming"
          ? "Confirming on Solana…"
          : status === "done"
          ? "Bought!"
          : `${side === "buy" ? "Buy" : "Sell"} $${coin.ticker}`}
      </button>

      {status === "error" && error && <p className="mt-3 text-center text-xs text-clay-red">{error}</p>}
      {status === "done" && signature && (
        <a
          href={`https://solscan.io/tx/${signature}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-center text-xs text-bamboo hover:underline"
        >
          View transaction
        </a>
      )}

      <p className="mt-3 text-center text-xs text-panda-grey">
        Real on-chain trade via Pump.fun, plus a 1% PANDA fee — both shown in your wallet before you sign. PANDA never holds your funds.
      </p>
    </div>
  );
}

function explainError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/reject|cancel/i.test(message)) return "You rejected the transaction.";
  if (/insufficient/i.test(message)) return "Insufficient balance for this trade plus fees.";
  if (/slippage/i.test(message)) return "Price moved too much — try again or raise slippage.";
  if (/graduated|PumpSwap/i.test(message)) return message;
  if (/blockhash|expired/i.test(message)) return "Transaction expired — try again.";
  return "Trade failed. Please try again.";
}
