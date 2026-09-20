"use client";

import { useEffect, useState } from "react";
import { confirmSignature } from "@/lib/solana/confirm";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getJupiterQuote, SOL_MINT } from "@/lib/jupiter/client";
import { base64ToVersionedTransaction } from "@/lib/pump/wire";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS } from "@/lib/pump/constants";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

const PANDA_MINT = process.env.NEXT_PUBLIC_PANDA_TOKEN_MINT || null;
const presets = [0.1, 0.5, 1];

/** A price impact from here up is flagged in orange, and from here up in red with a warning. */
const IMPACT_WARN_PCT = 1;
const IMPACT_HIGH_PCT = 5;

type Status = "idle" | "quoting" | "building" | "signing" | "confirming" | "done" | "error";
/** What Jupiter says this swap will do: what you get, the least you can get after slippage, and how much you move the price. */
type Quote = { out: number; min: number; impactPct: number };

/** Buys $PANDA the same way TradingPanel buys any non-Pump.fun coin — real Jupiter-routed swap, no PANDA custody. */
export default function BuyPandaWidget() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [decimals, setDecimals] = useState(6);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
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

  // Live quote as the user types — debounced, so it doesn't hammer Jupiter's quote endpoint on every keystroke.
  useEffect(() => {
    if (!PANDA_MINT) return;
    const sol = parseFloat(amount);
    const timer = setTimeout(() => {
      if (!sol || sol <= 0) {
        setQuote(null);
        setQuoteFailed(false);
        return;
      }
      setStatus("quoting");
      getJupiterQuote({
        inputMint: SOL_MINT,
        outputMint: PANDA_MINT,
        amount: String(Math.round(sol * 1e9)),
        slippageBps: Math.round(DEFAULT_SLIPPAGE_PCT * 100),
      })
        .then((q) => {
          setQuote({
            out: Number(q.outAmount) / 10 ** decimals,
            min: Number(q.otherAmountThreshold) / 10 ** decimals,
            // Jupiter reports the impact as a fraction (0.0030 = 0.30%).
            impactPct: Math.abs(Number(q.priceImpactPct) || 0) * 100,
          });
          setQuoteFailed(false);
        })
        .catch(() => {
          setQuote(null);
          setQuoteFailed(true);
        })
        .finally(() => setStatus("idle"));
    }, 400);
    return () => clearTimeout(timer);
  }, [amount, decimals]);

  if (!PANDA_MINT) {
    return (
      <div className="rounded-full border border-paper/15 px-4 py-2 text-right">
        <p className="text-xs font-medium">{t("bp.notLaunched")}</p>
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
      setError(t(explainError(err)));
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink transition hover:brightness-90">
        {t("bp.open")}
      </button>
    );
  }

  const busy = status === "building" || status === "signing" || status === "confirming";
  const sol = parseFloat(amount) || 0;
  const feeSol = (sol * PANDA_FEE_BPS) / 10_000;
  const fmt = (n: number, max = 2) => n.toLocaleString(lang, { maximumFractionDigits: max });
  const impact = quote?.impactPct ?? 0;
  const impactTone = impact >= IMPACT_HIGH_PCT ? "text-clay-red" : impact >= IMPACT_WARN_PCT ? "text-meme-orange" : "text-paper";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-paper/15 bg-ink-raised p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t("bp.open")}</p>
        <button onClick={() => setOpen(false)} className="text-panda-grey transition-colors hover:text-paper" aria-label={t("bp.close")}>
          <span aria-hidden>✕</span>
        </button>
      </div>

      <div className="mt-3">
        <label htmlFor="buy-panda-amount" className="mb-1 block text-xs text-panda-grey">
          {t("bp.youPay")}
        </label>
        <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink px-4 py-3 focus-within:border-bamboo/50">
          <input
            id="buy-panda-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            disabled={busy}
            className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-panda-grey disabled:opacity-50"
          />
          <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">SOL</span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {presets.map((p) => (
            <button key={p} onClick={() => setAmount(String(p))} disabled={busy} className="rounded-lg bg-paper/5 px-2.5 py-1 text-xs font-semibold text-paper/70 hover:bg-paper/10 hover:text-paper disabled:opacity-50">
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2">
        <span className="mb-1 block text-xs text-panda-grey">{t("bp.youReceive")}</span>
        <div className="rounded-2xl bg-ink px-4 py-3 text-lg font-medium" aria-live="polite">
          {quote ? `~${fmt(quote.out)}` : "—"} <span className="text-xs font-semibold text-paper/60">$PANDA</span>
        </div>
      </div>

      {/* What this trade will really do, before anything is signed. */}
      {quote && sol > 0 && (
        <dl className="mt-3 space-y-1.5 rounded-2xl bg-ink px-4 py-3 text-xs">
          <Row label={t("bp.min")} value={`${fmt(quote.min)} $PANDA`} />
          <Row label={t("bp.impact")} value={<span className={impactTone}>{impact < 0.01 ? "<0.01%" : `${fmt(impact)}%`}</span>} />
          <Row label={t("bp.slippage")} value={`${DEFAULT_SLIPPAGE_PCT}%`} />
          <Row label={t("bp.pandaFee", { pct: PANDA_FEE_BPS / 100 })} value={`${fmt(feeSol, 6)} SOL`} />
          <Row label={t("bp.total")} value={<span className="font-semibold">{`${fmt(sol + feeSol, 6)} SOL`}</span>} />
          <p className="pt-1 text-[11px] leading-relaxed text-panda-grey">{t("bp.feesNote")}</p>
        </dl>
      )}
      {quote && impact >= IMPACT_HIGH_PCT && (
        <p className="mt-2 rounded-xl bg-clay-red/10 px-3 py-2 text-xs text-clay-red" role="alert">
          {t("bp.highImpact", { pct: fmt(impact) })}
        </p>
      )}
      {quoteFailed && status !== "quoting" && <p className="mt-2 text-xs text-panda-grey">{t("bp.noQuote")}</p>}

      <button
        onClick={submit}
        disabled={!connected || !amount || busy}
        className="mt-3 w-full rounded-xl bg-bamboo py-3 text-sm font-bold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!connected
          ? t("bp.connect")
          : status === "building"
          ? t("bp.building")
          : status === "signing"
          ? t("bp.signing")
          : status === "confirming"
          ? t("bp.confirming")
          : status === "done"
          ? t("bp.done")
          : t("bp.open")}
      </button>

      {status === "error" && error && (
        <p className="mt-2 text-center text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
      {status === "done" && signature && (
        <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="mt-2 block text-center text-xs text-bamboo hover:underline">
          {t("bp.viewTx")}
        </a>
      )}
      <p className="mt-2 text-center text-xs text-panda-grey">{t("bp.routed")}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-panda-grey">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function explainError(err: unknown): DictKey {
  const message = err instanceof Error ? err.message : String(err);
  if (/reject|cancel/i.test(message)) return "bp.err.rejected";
  if (/insufficient/i.test(message)) return "bp.err.insufficient";
  if (/no route/i.test(message)) return "bp.err.noRoute";
  if (/blockhash|expired/i.test(message)) return "bp.err.expired";
  if (/429|too many requests/i.test(message)) return "bp.err.rateLimited";
  return "bp.err.generic";
}
