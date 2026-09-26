"use client";

import { sanitizeDecimalInput } from "@/lib/trading/input";
import { useEffect, useState } from "react";
import { confirmSignature } from "@/lib/solana/confirm";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Coin } from "@/lib/types";
import { PANDA_FEE_BPS } from "@/lib/pump/constants";
import { base64ToTransaction, base64ToVersionedTransaction } from "@/lib/pump/wire";
import { dexLabel } from "@/lib/dex-labels";
import { useReadConnection } from "@/lib/solana/useReadConnection";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { TxFailedError } from "@/lib/solana/tx-errors";
import { buyShortfall, maxBuyAmount, NETWORK_BUFFER_SOL, SELL_MIN_SOL } from "@/lib/trading/limits";
import { assetFromUnit, maxInViewUnit, toBaseUnits, unitFromAsset, type ViewUnit } from "@/lib/trading/amount";
import type { PayToken } from "@/lib/trading/pay-tokens";
import { useRates } from "@/components/coin/useRates";
import PayWithSelect, { type PayOption } from "@/components/coin/PayWithSelect";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const VIEW_SYMBOL: Record<Exclude<ViewUnit, "ASSET">, string> = { USD: "$", EUR: "€" };
const VIEW_PRESETS = [10, 25, 50];
const SOL_PRESETS = [0.1, 0.5, 1];
const TOKEN_PCT_PRESETS = [25, 50, 75];
const sellPresets = [25, 50, 100];

type Status = "idle" | "building" | "signing" | "sending" | "confirming" | "done" | "error";

export default function TradingPanel({ coin }: { coin: Coin }) {
  const { connection } = useConnection();
  const readConnection = useReadConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { t } = useLanguage();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  // What is typed is either the paying asset itself, or a dollar/euro *view* of it, converted with the real rates.
  const [unit, setUnit] = useState<ViewUnit>("ASSET");
  const [payMint, setPayMint] = useState(SOL_MINT);
  const [payTokens, setPayTokens] = useState<PayToken[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const rates = useRates(coin.mint);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        // Shared with the strategy card, which stores "SOL" for "the asset itself".
        const u = localStorage.getItem("panda.buy.unit");
        if (u === "USD" || u === "EUR") setUnit(u);
      } catch {}
    });
  }, []);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState(6);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");

  const graduated = coin.source === "pumpswap";
  const externalDex = coin.source === "other";
  // A coin still on Pump.fun's bonding curve is bought with SOL only; graduated and external coins go through Jupiter, which can take any token.
  const onlySol = !graduated && !externalDex;

  // The tokens this wallet holds that have a live market — what it can pay with besides SOL.
  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    Promise.resolve().then(() => !cancelled && setPayLoading(true));
    fetch(`/api/wallet/pay-tokens?wallet=${publicKey.toBase58()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tokens: [] }))
      .then((d: { tokens?: PayToken[] }) => !cancelled && setPayTokens(d.tokens ?? []))
      .catch(() => !cancelled && setPayTokens([]))
      .finally(() => !cancelled && setPayLoading(false));
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, status]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    readConnection
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
  }, [connected, publicKey, readConnection, status]);

  // Real on-chain balance of this specific token, used for the Sell % presets.
  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    readConnection
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
  }, [connected, publicKey, readConnection, coin.mint, status]);

  const displaySol = connected ? solBalance : null;
  const displayTokens = connected ? tokenBalance : null;

  // Say "you don't have enough" BEFORE anything is signed: a transaction that runs out of SOL fails on-chain and still costs the network fee.
  const options: PayOption[] = [
    { mint: SOL_MINT, symbol: "SOL", balance: displaySol, decimals: 9, priceUsd: rates.solUsd },
    ...payTokens
      .filter((tk) => tk.mint !== coin.mint)
      .map((tk) => ({ mint: tk.mint, symbol: tk.symbol, image: tk.image, balance: tk.amount, decimals: tk.decimals, priceUsd: tk.priceUsd })),
  ];
  // Falls back to SOL if the chosen token is no longer offered (wallet changed, or the coin can only be bought with SOL).
  const pay = (onlySol ? undefined : options.find((o) => o.mint === payMint)) ?? options[0];
  const paidInSol = pay.mint === SOL_MINT;

  const typed = parseFloat(amount) || 0;
  const payAmt = assetFromUnit(unit, typed, pay.priceUsd, rates.eurUsd, pay.decimals); // null: no live price for this view right now
  const buySol = paidInSol ? payAmt : null;
  const amt = side === "buy" ? payAmt ?? 0 : typed;
  const noRate = side === "buy" && typed > 0 && payAmt === null;
  // Paid with a token, PANDA's fee is still a SOL transfer: a share of what the token is worth in SOL, on top of it.
  const feeSol = !paidInSol && pay.priceUsd && rates.solUsd ? (amt * pay.priceUsd * (PANDA_FEE_BPS / 10_000)) / rates.solUsd : 0;
  const buyShort = side === "buy" && connected && paidInSol ? buyShortfall(amt, displaySol) : null;
  const tokenShort = side === "buy" && connected && !paidInSol && pay.balance !== null && amt > pay.balance ? { need: amt, have: pay.balance } : null;
  const needSolForFee = !paidInSol && amt > 0 ? feeSol + NETWORK_BUFFER_SOL : 0;
  const feeShort = side === "buy" && connected && !paidInSol && amt > 0 && displaySol !== null && displaySol < needSolForFee ? { need: needSolForFee, have: displaySol } : null;
  const sellNoTokens = side === "sell" && connected && displayTokens !== null && amt > displayTokens;
  const sellNoSol = side === "sell" && connected && displaySol !== null && amt > 0 && displaySol < SELL_MIN_SOL;
  const blocked = !!buyShort || !!tokenShort || !!feeShort || sellNoTokens || sellNoSol || noRate;
  const fmtSol = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const fmtAsset = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: Math.min(pay.decimals, 6) });

  function rememberUnit(next: ViewUnit) {
    try {
      localStorage.setItem("panda.buy.unit", next === "ASSET" ? "SOL" : next);
    } catch {}
  }

  function pickUnit(next: ViewUnit) {
    if (next === unit) return;
    // Keep the same value, shown in the new view.
    const converted = payAmt && payAmt > 0 ? unitFromAsset(next, payAmt, pay.priceUsd, rates.eurUsd) : null;
    setUnit(next);
    rememberUnit(next);
    if (amount) setAmount(converted !== null ? String(Number(converted.toFixed(next === "ASSET" ? Math.min(pay.decimals, 6) : 2))) : "");
  }

  function pickPay(mint: string) {
    if (mint === pay.mint) return;
    // A figure typed in the old asset means nothing in the new one, so the amount is cleared; the $/€ view is kept.
    setPayMint(mint);
    setAmount("");
  }

  async function submit() {
    if (!connected || !publicKey || !amount) return;
    if (side === "buy" && !(payAmt && payAmt > 0)) return;
    setError("");
    setSignature("");
    try {
      setStatus("building");
      // Graduated coins trade on PumpSwap — the real pool address is
      // already on `coin` (the same one every other page gets it from), so
      // the server doesn't have to guess or re-derive it.
      const poolAddress = graduated ? coin.poolAddress : undefined;
      const body =
        side === "buy" && !paidInSol
          ? { mint: coin.mint, user: publicKey.toBase58(), payMint: pay.mint, payAmount: toBaseUnits(amt, pay.decimals) }
          : side === "buy"
          ? { mint: coin.mint, user: publicKey.toBase58(), solAmount: buySol, poolAddress }
          : {
              mint: coin.mint,
              user: publicKey.toBase58(),
              tokenAmount: Math.round(parseFloat(amount) * 10 ** tokenDecimals).toString(),
              poolAddress,
            };

      // Jupiter takes external coins, and any buy paid with a token (Pump.fun's own builders only deal in SOL).
      const viaJupiter = externalDex || (side === "buy" && !paidInSol);
      const endpoint = viaJupiter ? "/api/jupiter/swap" : `/api/pump/${side}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(viaJupiter ? { ...body, side } : body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to build transaction.");

      const tx: Transaction | VersionedTransaction = viaJupiter
        ? base64ToVersionedTransaction(data.transaction)
        : base64ToTransaction(data.transaction);

      setStatus("signing");
      const sig = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });

      setStatus("confirming");
      await confirmSignature(connection, sig);

      setSignature(sig);
      setStatus("done");

      // Best-effort — the trade itself already succeeded either way; this
      // just adds it to the wallet's real trade history for Portfolio's
      // open/closed positions view.
      // Not for a buy paid with a token: the trade log prices a buy by the SOL that left the wallet, which here is only the fee.
      if (publicKey && (side === "sell" || paidInSol)) {
        fetch("/api/portfolio/record-trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: publicKey.toBase58(), mint: coin.mint, ticker: coin.ticker, side, signature: sig }),
        }).catch(() => {});
      }

      setTimeout(() => {
        setStatus("idle");
        setAmount("");
      }, 4000);
    } catch (err) {
      setStatus("error");
      const e = explainError(err);
      setError(typeof e === "string" ? e : t(e.key));
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
          {t("trading.buy")}
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`rounded-xl py-2.5 text-sm font-bold transition-all ${
            side === "sell"
              ? "bg-clay-red text-ink shadow-[0_0_0_1px_rgba(232,84,62,0.4)]"
              : "bg-ink text-panda-grey hover:text-paper"
          }`}
        >
          {t("trading.sell")}
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-panda-grey">
          {side === "buy" ? t("trading.payBalance") : t("trading.tokenBalance", { ticker: coin.ticker })}
        </span>
        <span className="font-medium">
          {side === "buy"
            ? pay.balance !== null && connected
              ? `${paidInSol ? pay.balance.toFixed(2) : fmtAsset(pay.balance)} ${pay.symbol}`
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
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
              placeholder="0.0"
              inputMode="decimal"
              disabled={busy}
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey disabled:opacity-50"
            />
            <PayWithSelect options={options} value={pay.mint} onChange={pickPay} disabled={busy || !connected} loading={payLoading} onlySol={onlySol} />
          </div>

          {/* What the figure above means: the paying asset itself, or its value in dollars / euros. Separate from "Pay with" on purpose. */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-panda-grey">{t("trading.view")}</span>
            <div className="flex gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={t("trading.view")}>
              {(["ASSET", "USD", "EUR"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => pickUnit(u)}
                  disabled={busy}
                  aria-pressed={unit === u}
                  className={`min-w-8 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${unit === u ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
                >
                  {u === "ASSET" ? pay.symbol : VIEW_SYMBOL[u]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {(unit === "ASSET" ? (paidInSol ? SOL_PRESETS : TOKEN_PCT_PRESETS) : VIEW_PRESETS).map((p) => {
              // With another token there is no sensible fixed figure, so the presets are shares of what the wallet holds.
              const asPct = unit === "ASSET" && !paidInSol;
              const value = asPct ? (pay.balance !== null ? maxInViewUnit("ASSET", (pay.balance * p) / 100, pay.priceUsd, rates.eurUsd, pay.decimals) : null) : p;
              return (
                <button
                  key={p}
                  onClick={() => value !== null && setAmount(String(value))}
                  disabled={busy || value === null}
                  className={`rounded-xl py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    amount === String(value) ? "bg-bamboo/15 text-bamboo" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"
                  }`}
                >
                  {asPct ? `${p}%` : unit === "ASSET" ? p : `${VIEW_SYMBOL[unit as "USD" | "EUR"]}${p}`}
                </button>
              );
            })}
            <button
              onClick={() => {
                // SOL keeps back what the fee and the network need; another token can go in full (its fee is paid in SOL).
                const maxAsset = paidInSol ? (displaySol !== null ? maxBuyAmount(displaySol) : null) : pay.balance;
                const m = maxAsset !== null ? maxInViewUnit(unit, maxAsset, pay.priceUsd, rates.eurUsd, pay.decimals) : null;
                setAmount(m && m > 0 ? String(m) : "");
              }}
              disabled={busy}
              className="rounded-xl bg-paper/5 py-2 text-xs font-semibold text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper disabled:opacity-50"
            >
              {t("trading.max")}
            </button>
          </div>

          {typed > 0 && !noRate && (
            <p className="mt-2 text-xs text-panda-grey">
              {unit === "ASSET"
                ? [unitFromAsset("USD", amt, pay.priceUsd, rates.eurUsd) !== null && `≈ ${money(unitFromAsset("USD", amt, pay.priceUsd, rates.eurUsd)!, "USD")}`, unitFromAsset("EUR", amt, pay.priceUsd, rates.eurUsd) !== null && `≈ ${money(unitFromAsset("EUR", amt, pay.priceUsd, rates.eurUsd)!, "EUR")}`].filter(Boolean).join(" · ")
                : `≈ ${fmtAsset(amt)} ${pay.symbol}`}
            </p>
          )}
          {noRate && <p className="mt-2 text-xs text-clay-red">{paidInSol ? t("trading.noRate") : t("trading.payNoPrice", { symbol: pay.symbol })}</p>}

          {amt > 0 && (
            <div className="mt-3 space-y-1 rounded-xl bg-ink px-3.5 py-3 text-xs">
              <div className="flex items-center justify-between text-panda-grey">
                <span>{t("trading.amount")}</span>
                <span>{paidInSol ? amt.toFixed(4) : fmtAsset(amt)} {pay.symbol}</span>
              </div>
              <div className="flex items-center justify-between text-panda-grey">
                <span>{paidInSol ? t("trading.pandaFee", { pct: PANDA_FEE_BPS / 100 }) : t("trading.pandaFeeSol", { pct: PANDA_FEE_BPS / 100 })}</span>
                <span>{paidInSol ? ((amt * PANDA_FEE_BPS) / 10_000).toFixed(4) : feeSol > 0 ? `≈ ${feeSol.toFixed(5)}` : "—"} SOL</span>
              </div>
              <div className="flex items-center justify-between border-t border-paper/10 pt-1 font-semibold text-paper">
                <span>{t("trading.youPay")}</span>
                <span>{paidInSol ? (amt * (1 + PANDA_FEE_BPS / 10_000)).toFixed(4) : fmtAsset(amt)} {pay.symbol}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink px-4 py-3.5 focus-within:border-clay-red/50">
            <input
              value={amount}
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
              placeholder="0"
              inputMode="decimal"
              disabled={busy}
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey disabled:opacity-50"
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

          {!!parseFloat(amount) && (
            <p className="mt-3 rounded-xl bg-ink px-3.5 py-3 text-xs text-panda-grey">
              {t("trading.sellFeeNote", { pct: PANDA_FEE_BPS / 100 })}
            </p>
          )}
        </div>
      )}

      {buyShort && (
        <div className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
          <p>{t("trading.notEnoughSol", { need: fmtSol(buyShort.need), have: fmtSol(buyShort.have) })}</p>
          {buyShort.max > 0 && (
            <button onClick={() => setAmount(String(buyShort.max))} className="mt-2 font-semibold underline underline-offset-2">
              {t("trading.useMax", { max: fmtSol(buyShort.max) })}
            </button>
          )}
        </div>
      )}
      {tokenShort && (
        <p className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
          {t("trading.notEnoughToken", { symbol: pay.symbol, need: fmtAsset(tokenShort.need), have: fmtAsset(tokenShort.have) })}
        </p>
      )}
      {feeShort && (
        <p className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
          {t("trading.needSolFee", { need: fmtSol(feeShort.need), have: fmtSol(feeShort.have) })}
        </p>
      )}
      {sellNoTokens && (
        <p className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
          {t("trading.notEnoughTokens", { have: (displayTokens ?? 0).toLocaleString(), ticker: coin.ticker })}
        </p>
      )}
      {sellNoSol && (
        <p className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
          {t("trading.notEnoughSolFee")}
        </p>
      )}

      <button
        onClick={submit}
        disabled={!connected || !amount || busy || blocked}
        className={`mt-3 w-full rounded-xl py-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          side === "buy" ? "bg-bamboo text-ink hover:brightness-110" : "bg-clay-red text-ink hover:brightness-110"
        }`}
      >
        {!connected
          ? t("trading.connectToTrade")
          : status === "building"
          ? t("trading.preparing")
          : status === "signing"
          ? t("trading.confirmInWallet")
          : status === "sending"
          ? t("trading.sending")
          : status === "confirming"
          ? t("trading.confirmingOnChain")
          : status === "done"
          ? t(side === "buy" ? "trading.bought" : "trading.sold")
          : t(side === "buy" ? "trading.buyLabel" : "trading.sellLabel", { ticker: coin.ticker })}
      </button>

      {status === "error" && error && (
        <p className="mt-3 text-center text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
      {status === "done" && signature && (
        <a
          href={`https://solscan.io/tx/${signature}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-center text-xs text-bamboo hover:underline"
        >
          {t("trading.viewTransaction")}
        </a>
      )}

      {externalDex ? (
        <p className="mt-3 text-center text-xs text-panda-grey">
          {t("trading.disclaimerExternal", { dex: dexLabel(coin.dex) })}
        </p>
      ) : graduated ? (
        <p className="mt-3 text-center text-xs text-panda-grey">{t("trading.disclaimerGraduated")}</p>
      ) : (
        <p className="mt-3 text-center text-xs text-panda-grey">{t("trading.disclaimerBondingCurve")}</p>
      )}
    </div>
  );
}

const money = (n: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);

/** A translated key for what went wrong, or the server's own message when it is already specific. */
function explainError(err: unknown): DictKey | { key: DictKey } | string {
  if (err instanceof TxFailedError) {
    const byReason: Record<TxFailedError["reason"], DictKey> = {
      insufficient_sol: "trading.err.insufficientSol",
      insufficient_tokens: "trading.err.insufficientTokens",
      slippage: "trading.err.slippage",
      account_missing: "trading.err.accountMissing",
      expired: "trading.err.expired",
      unknown: "trading.err.failedOnchain",
    };
    return { key: byReason[err.reason] };
  }
  const message = err instanceof Error ? err.message : String(err);
  const key = (k: DictKey) => ({ key: k });
  if (/reject|cancel/i.test(message)) return key("trading.err.rejected");
  if (/can't be traded with SOL/i.test(message)) return key("trading.err.poolNotTradable");
  if (/insufficient/i.test(message)) return key("trading.err.insufficientSol");
  if (/slippage/i.test(message)) return key("trading.err.slippage");
  if (/graduated|PumpSwap/i.test(message)) return message;
  if (/no route/i.test(message)) return key("trading.err.noRoute");
  if (/blockhash|expired/i.test(message)) return key("trading.err.expired");
  if (/429|too many requests/i.test(message)) return key("trading.err.rateLimited");
  if (/fetch failed|network|ECONNRESET|timeout/i.test(message)) return key("trading.err.network");
  if (/failed on-chain/i.test(message)) return key("trading.err.failedOnchain");
  if (/failed to confirm/i.test(message)) return key("trading.err.confirmTimeout");
  return key("trading.err.generic");
}
