"use client";

import { sanitizeDecimalInput } from "@/lib/trading/input";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmSignature } from "@/lib/solana/confirm";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Coin } from "@/lib/types";
import { base64ToTransaction, base64ToVersionedTransaction } from "@/lib/pump/wire";
import { PANDA_FEE_BPS } from "@/lib/pump/constants";
import { useFeeBps } from "@/lib/pump/useFeeBps";
import { dexLabel } from "@/lib/dex-labels";
import { useReadConnection } from "@/lib/solana/useReadConnection";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { TxFailedError } from "@/lib/solana/tx-errors";
import { buyShortfall, maxBuyAmount, NETWORK_BUFFER_SOL, SELL_MIN_SOL } from "@/lib/trading/limits";
import { assetFromUnit, maxInViewUnit, solToUnit, toBaseUnits, unitFromAsset, unitToSol, type BuyUnit, type ViewUnit } from "@/lib/trading/amount";
import type { PayToken } from "@/lib/trading/pay-tokens";
import { useRates } from "@/components/coin/useRates";
import { usePriceImpact } from "@/components/coin/usePriceImpact";
import { PRICE_IMPACT_HIGH_PCT, PRICE_IMPACT_WARN_PCT } from "@/lib/strategy/plan";
import PayWithSelect, { type PayOption } from "@/components/coin/PayWithSelect";
import { compactAmount, holdingValue, isRejection, settleByBalance } from "@/lib/trading/outcome";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const VIEW_SYMBOL: Record<Exclude<ViewUnit, "ASSET">, string> = { USD: "$", EUR: "€" };
const VIEW_PRESETS = [10, 25, 50];
const SOL_PRESETS = [0.1, 0.5, 1];
const TOKEN_PCT_PRESETS = [25, 50, 75];
const sellPresets = [25, 50, 75, 100];

/** "checking": the wallet or the confirmation didn't give a straight answer, so the chain is being asked what happened.
 *  "pending": sent, still neither confirmed nor failed — neither a success nor an error is claimed. */
type Status = "idle" | "building" | "signing" | "sending" | "confirming" | "checking" | "pending" | "done" | "error";

/** Other parts of the page (Draw Your Trade) re-read the wallet's balance of the coin when a trade lands. */
export const BALANCE_EVENT = "panda:balance-changed";

export default function TradingPanel({ coin }: { coin: Coin }) {
  const { connection } = useConnection();
  const readConnection = useReadConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const feeBps = useFeeBps(connected ? publicKey?.toBase58() : null);
  const { t, lang } = useLanguage();
  // The "· priced with a code" suffix only ever appears for a wallet that is ACTUALLY paying less — never as a
  // pitch to someone who isn't, see src/lib/referrals/client.ts's ReferralWelcomeBanner for where that pitch belongs instead.
  const feeLabel = (key: "trading.pandaFee" | "trading.pandaFeeSol") => `${t(key, { pct: feeBps / 100 })}${feeBps < PANDA_FEE_BPS ? t("trading.pricedWithCode") : ""}`;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  // What is typed is either the paying asset itself, or a dollar/euro *view* of it, converted with the real rates.
  const [unit, setUnit] = useState<ViewUnit>("ASSET");
  // What a sell is denominated in — SOL/$/€ received, never the token itself: a sell always pays out
  // in SOL (see `impact`'s outputMint below), so "how many tokens" alone doesn't tell you what you're
  // getting; this answers that directly, the same way the Buy side already shows what you're spending.
  const [sellUnit, setSellUnit] = useState<BuyUnit>("SOL");
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
        const su = localStorage.getItem("panda.sell.unit");
        if (su === "SOL" || su === "USD" || su === "EUR") setSellUnit(su);
      } catch {}
    });
  }, []);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState(6);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");
  const [impactAck, setImpactAck] = useState(false);
  // Bumped a few times after a trade lands: the RPC can take a moment to show the new balances.
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** The wallet's balance of this coin in raw units, read fresh (every token account of the mint). null = unknown. */
  const readTokenRaw = useCallback(async (): Promise<bigint | null> => {
    if (!publicKey) return null;
    const res = await readConnection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(coin.mint) });
    return res.value.reduce((sum, a) => sum + BigInt(a.account.data.parsed?.info?.tokenAmount?.amount ?? "0"), BigInt(0));
  }, [publicKey, readConnection, coin.mint]);

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
  }, [connected, publicKey, status, refresh]);

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
  }, [connected, publicKey, readConnection, status, refresh]);

  // Real on-chain balance of this specific token, used for the Sell % presets.
  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    readConnection
      .getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(coin.mint) })
      .then((res) => {
        if (cancelled) return;
        const info = res.value[0]?.account.data.parsed?.info?.tokenAmount;
        setTokenBalance(res.value.reduce((sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0));
        if (info?.decimals !== undefined) setTokenDecimals(info.decimals);
      })
      .catch(() => {
        if (!cancelled) setTokenBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, readConnection, coin.mint, status, refresh]);
  // …and every 30 s while the page is visible, so the "you hold" line also follows what happens outside this box
  // (an order that executed, a transfer).
  useEffect(() => {
    if (!connected) return;
    const tick = setInterval(() => document.visibilityState !== "hidden" && setRefresh((n) => n + 1), 30_000);
    return () => clearInterval(tick);
  }, [connected]);

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

  // Sell is denominated in SOL/$/€ received, not the token: convert through the coin's own live USD
  // price and the SOL/EUR rates (unitToSol already converts a SOL/USD/EUR figure to SOL; from there,
  // 1 token = tokenPriceUsd USD and 1 SOL = rates.solUsd USD gives the real token amount to sell).
  // Missing price/rate → null, same "can't be used yet" meaning as the Buy side's own noRate.
  const tokenPriceUsd = coin.livePriceUsd ?? null;
  function sellUnitToTokens(u: BuyUnit, value: number): number | null {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const sol = unitToSol(u, value, rates);
    if (sol === null || !tokenPriceUsd || !rates.solUsd) return null;
    return (sol * rates.solUsd) / tokenPriceUsd;
  }
  function tokensToSellUnit(u: BuyUnit, tokenAmt: number): number | null {
    if (!tokenPriceUsd || !rates.solUsd) return null;
    return solToUnit(u, (tokenAmt * tokenPriceUsd) / rates.solUsd, rates);
  }
  const sellTokenAmount = side === "sell" ? sellUnitToTokens(sellUnit, typed) : null;
  const sellNoRate = side === "sell" && typed > 0 && sellTokenAmount === null;

  const amt = side === "buy" ? payAmt ?? 0 : sellTokenAmount ?? 0;
  const noRate = side === "buy" && typed > 0 && payAmt === null;
  // Paid with a token, PANDA's fee is still a SOL transfer: a share of what the token is worth in SOL, on top of it.
  const feeSol = !paidInSol && pay.priceUsd && rates.solUsd ? (amt * pay.priceUsd * (feeBps / 10_000)) / rates.solUsd : 0;
  const buyShort = side === "buy" && connected && paidInSol ? buyShortfall(amt, displaySol) : null;
  const tokenShort = side === "buy" && connected && !paidInSol && pay.balance !== null && amt > pay.balance ? { need: amt, have: pay.balance } : null;
  const needSolForFee = !paidInSol && amt > 0 ? feeSol + NETWORK_BUFFER_SOL : 0;
  const feeShort = side === "buy" && connected && !paidInSol && amt > 0 && displaySol !== null && displaySol < needSolForFee ? { need: needSolForFee, have: displaySol } : null;
  const sellNoTokens = side === "sell" && connected && displayTokens !== null && amt > displayTokens;
  const sellNoSol = side === "sell" && connected && displaySol !== null && amt > 0 && displaySol < SELL_MIN_SOL;
  const sellFeeInUnit = side === "sell" && amt > 0 ? tokensToSellUnit(sellUnit, (amt * feeBps) / 10_000) : null;

  // How much this trade would move the price — on-curve (still on Pump.fun's own bonding curve) is computed
  // straight from the curve's real reserves; graduated/external uses Jupiter's own public quote instead.
  const onCurve = onlySol;
  const sellTokenRaw = side === "sell" && amt > 0 ? Math.round(amt * 10 ** tokenDecimals).toString() : undefined;
  const impact = usePriceImpact({
    mint: coin.mint,
    onCurve,
    side,
    solAmount: onCurve && side === "buy" ? amt : undefined,
    tokenAmountRaw: onCurve && side === "sell" ? sellTokenRaw : undefined,
    inputMint: side === "buy" ? pay.mint : coin.mint,
    outputMint: side === "buy" ? coin.mint : SOL_MINT,
    inputAmountRaw: !onCurve ? (side === "buy" ? toBaseUnits(amt, pay.decimals) : sellTokenRaw) : undefined,
  });
  const impactHigh = impact.pct !== null && impact.pct >= PRICE_IMPACT_HIGH_PCT;
  const impactWarn = impact.pct !== null && impact.pct >= PRICE_IMPACT_WARN_PCT;
  useEffect(() => {
    Promise.resolve().then(() => setImpactAck(false));
  }, [amount, side, payMint]);

  const blocked = !!buyShort || !!tokenShort || !!feeShort || sellNoTokens || sellNoSol || noRate || sellNoRate || (impactHigh && !impactAck);
  const fmtSol = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const fmtAsset = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: Math.min(pay.decimals, 6) });
  const roundSellValue = (u: BuyUnit, v: number) => {
    const places = u === "SOL" ? 6 : 2;
    return Math.floor(v * 10 ** places + 1e-9) / 10 ** places;
  };

  function rememberUnit(next: ViewUnit) {
    try {
      localStorage.setItem("panda.buy.unit", next === "ASSET" ? "SOL" : next);
    } catch {}
  }

  function pickSellUnit(next: BuyUnit) {
    if (next === sellUnit) return;
    const converted = sellTokenAmount !== null && sellTokenAmount > 0 ? tokensToSellUnit(next, sellTokenAmount) : null;
    setSellUnit(next);
    try {
      localStorage.setItem("panda.sell.unit", next);
    } catch {}
    if (amount) setAmount(converted !== null ? String(roundSellValue(next, converted)) : "");
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
    if (side === "sell" && !(amt > 0)) return;
    setError("");
    setSignature("");
    let sig: string | undefined;
    let beforeRaw: bigint | null | undefined; // undefined until the wallet is about to be asked
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
              // `amt` is the real token count — amount/amountUnit above is denominated in SOL/$/€ received, not tokens.
              tokenAmount: Math.round(amt * 10 ** tokenDecimals).toString(),
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

      // The balance BEFORE, so that whatever the wallet or the RPC say afterwards, the chain can be asked what happened.
      beforeRaw = await readTokenRaw().catch(() => null);
      setStatus("signing");
      sig = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });
      setSignature(sig);

      setStatus("confirming");
      await confirmSignature(connection, sig);
      landed(sig);
    } catch (err) {
      // Said no in the wallet, or the transaction landed and FAILED: both are certain, and both are shown as they are.
      if (isRejection(err) || err instanceof TxFailedError || !sent()) return fail(err);
      // Anything else (a wallet that errors after broadcasting, a confirmation that timed out, a flaky RPC) proves
      // nothing either way: the coin's balance in the wallet does.
      setStatus("checking");
      if ((await settleByBalance({ side, beforeRaw: beforeRaw ?? null, read: readTokenRaw })) === "landed") return landed(sig);
      if (!sig) return fail(err);
      // Sent, and still neither confirmed nor failed: say exactly that, and keep asking in the background.
      setStatus("pending");
      const pendingSig = sig;
      confirmSignature(connection, pendingSig, 180_000).then(
        () => alive.current && landed(pendingSig),
        (late) => alive.current && (late instanceof TxFailedError ? fail(late) : undefined)
      );
    }

    /** Past the point where the wallet may have broadcast it (it was asked to sign and send). */
    function sent() {
      return beforeRaw !== undefined;
    }
    function fail(err: unknown) {
      setStatus("error");
      const e = explainError(err);
      setError(typeof e === "string" ? e : t(e.key));
    }
    function landed(landedSig: string | undefined) {
      if (landedSig) setSignature(landedSig);
      setStatus("done");
      // The new balances, now and again in a moment (the RPC can lag a few seconds) — here and in Draw Your Trade.
      for (const ms of [0, 2500, 7000]) {
        setTimeout(() => {
          if (!alive.current) return;
          setRefresh((n) => n + 1);
          window.dispatchEvent(new Event(BALANCE_EVENT));
        }, ms);
      }
      // Best-effort — the trade itself already succeeded either way; this
      // just adds it to the wallet's real trade history for Portfolio's
      // open/closed positions view.
      // Not for a buy paid with a token: the trade log prices a buy by the SOL that left the wallet, which here is only the fee.
      if (publicKey && landedSig && (side === "sell" || paidInSol)) {
        fetch("/api/portfolio/record-trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: publicKey.toBase58(), mint: coin.mint, ticker: coin.ticker, side, signature: landedSig }),
        }).catch(() => {});
      }
      setTimeout(() => {
        if (!alive.current) return;
        setStatus("idle");
        setAmount("");
      }, 4000);
    }
  }

  const busy = status !== "idle" && status !== "error" && status !== "done" && status !== "pending";
  const holdValue = displayTokens !== null && displayTokens > 0 ? holdingValue(displayTokens, coin.livePriceUsd, lang) : null;

  return (
    <div className="rounded-[22px] border border-paper/10 bg-ink-raised p-4">
      {/* What this wallet holds of this coin — only when it holds some. */}
      {displayTokens !== null && displayTokens > 0 && (
        <p className="mb-3 flex flex-wrap items-baseline gap-x-1.5 rounded-xl bg-bamboo/10 px-3 py-2 text-xs text-paper/90" data-testid="holding">
          <span className="text-panda-grey">{t("trading.youHold")}</span>
          <span className="font-semibold tabular-nums text-paper">
            {compactAmount(displayTokens, lang)} {coin.ticker}
          </span>
          {holdValue && <span className="tabular-nums text-panda-grey">· ≈ {holdValue}</span>}
        </p>
      )}
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
                <span>{paidInSol ? feeLabel("trading.pandaFee") : feeLabel("trading.pandaFeeSol")}</span>
                <span>{paidInSol ? ((amt * feeBps) / 10_000).toFixed(4) : feeSol > 0 ? `≈ ${feeSol.toFixed(5)}` : "—"} SOL</span>
              </div>
              <div className="flex items-center justify-between border-t border-paper/10 pt-1 font-semibold text-paper">
                <span>{t("trading.youPay")}</span>
                <span>{paidInSol ? (amt * (1 + feeBps / 10_000)).toFixed(4) : fmtAsset(amt)} {pay.symbol}</span>
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
            <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">{sellUnit === "SOL" ? "SOL" : VIEW_SYMBOL[sellUnit]}</span>
          </div>

          {/* What the figure above means: how much you receive, in SOL or its dollar/euro value — a sell always pays
              out in SOL (see `impact`'s outputMint), so this is what actually answers "how much do I get". */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-panda-grey">{t("trading.receiveIn")}</span>
            <div className="flex gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={t("trading.receiveIn")}>
              {(["SOL", "USD", "EUR"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => pickSellUnit(u)}
                  disabled={busy}
                  aria-pressed={sellUnit === u}
                  className={`min-w-8 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${sellUnit === u ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
                >
                  {u === "SOL" ? "SOL" : VIEW_SYMBOL[u]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {sellPresets.map((pct) => {
              const pctTokens = displayTokens !== null ? (displayTokens * pct) / 100 : null;
              const value = pctTokens !== null ? tokensToSellUnit(sellUnit, pctTokens) : null;
              const rounded = value !== null ? roundSellValue(sellUnit, value) : null;
              return (
                <button
                  key={pct}
                  onClick={() => rounded !== null && setAmount(String(rounded))}
                  disabled={busy || rounded === null}
                  className={`rounded-xl py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    rounded !== null && amount === String(rounded) ? "bg-clay-red/15 text-clay-red" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"
                  }`}
                >
                  {pct}%
                </button>
              );
            })}
          </div>

          {typed > 0 && !sellNoRate && (
            <p className="mt-2 text-xs text-panda-grey">≈ {fmtAsset(amt)} ${coin.ticker}</p>
          )}
          {sellNoRate && <p className="mt-2 text-xs text-clay-red">{t("trading.noRate")}</p>}

          {amt > 0 && (
            <div className="mt-3 space-y-1 rounded-xl bg-ink px-3.5 py-3 text-xs">
              <div className="flex items-center justify-between text-panda-grey">
                <span>{t("trading.amount")}</span>
                <span>{fmtAsset(amt)} ${coin.ticker}</span>
              </div>
              <div className="flex items-center justify-between text-panda-grey">
                <span>{feeLabel("trading.pandaFeeSol")}</span>
                <span>{sellFeeInUnit !== null ? `≈ ${roundSellValue(sellUnit, sellFeeInUnit)}` : "—"} {sellUnit === "SOL" ? "SOL" : VIEW_SYMBOL[sellUnit]}</span>
              </div>
              <div className="flex items-center justify-between border-t border-paper/10 pt-1 font-semibold text-paper">
                <span>{t("trading.youReceive")}</span>
                <span>
                  {sellFeeInUnit !== null ? roundSellValue(sellUnit, Math.max(0, typed - sellFeeInUnit)) : typed} {sellUnit === "SOL" ? "SOL" : VIEW_SYMBOL[sellUnit]}
                </span>
              </div>
            </div>
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
      {impactWarn && (
        <div className={`mt-3 rounded-xl px-3.5 py-3 text-xs ${impactHigh ? "bg-clay-red/10 text-clay-red" : "bg-sun/10 text-sun"}`} role="alert">
          <p>{t(impactHigh ? "trading.priceImpactHigh" : "trading.priceImpact", { pct: impact.pct!.toFixed(1) })}</p>
          {impactHigh && (
            <label className="mt-2 flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={impactAck} onChange={(e) => setImpactAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--clay-red)]" />
              <span>{t("trading.priceImpactAck")}</span>
            </label>
          )}
        </div>
      )}
      {impact.exceedsCurve && (
        <p className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
          {t("trading.exceedsCurve")}
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
          : status === "checking"
          ? t("trading.checkingChain")
          : status === "pending"
          ? t("trading.pendingShort")
          : status === "done"
          ? t(side === "buy" ? "trading.bought" : "trading.sold")
          : t(side === "buy" ? "trading.buyLabel" : "trading.sellLabel", { ticker: coin.ticker })}
      </button>

      {status === "error" && error && (
        <p className="mt-3 text-center text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
      {status === "pending" && (
        <p className="mt-3 text-center text-xs text-sun" role="status">
          {t("trading.pendingNote")}
        </p>
      )}
      {(status === "done" || status === "pending") && signature && (
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
