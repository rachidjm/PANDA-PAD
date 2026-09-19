"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Coin } from "@/lib/types";
import type { Position } from "@/lib/portfolio/positions";
import type { TriggerOrder } from "@/lib/jupiter/trigger";
import { base64ToVersionedTransaction, versionedTransactionToBase64 } from "@/lib/pump/wire";
import { formatUsd } from "@/lib/format";
import { useReadConnection } from "@/lib/solana/useReadConnection";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_SLIPPAGE_BPS = 500; // 5%, same default as the rest of the app
const EXPIRES_IN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — fixed for this MVP, disclosed in copy

type Status =
  | "idle"
  | "authenticating"
  | "depositing"
  | "creating"
  | "done"
  | "error";
type CancelStatus = "idle" | "cancelling" | "error";

export default function StopLossTakeProfit({ coin }: { coin: Coin }) {
  const connection = useReadConnection();
  const { connected, publicKey, signMessage, signTransaction } = useWallet();
  const { t } = useLanguage();

  const [position, setPosition] = useState<Position | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState(6);
  const [open, setOpen] = useState(false);
  const [slPrice, setSlPrice] = useState("");
  const [tpPrice, setTpPrice] = useState("");
  const [amountPct, setAmountPct] = useState(100);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<TriggerOrder[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [cancelStatus, setCancelStatus] = useState<Record<string, CancelStatus>>({});

  // Only show this on a coin the wallet actually holds an open position in —
  // reuses the same real trade-log-derived positions as /portfolio.
  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    fetch(`/api/portfolio/positions?wallet=${publicKey.toBase58()}`)
      .then((r) => r.json())
      .then((data: { open?: Position[] }) => {
        if (cancelled) return;
        setPosition((data.open || []).find((p) => p.mint === coin.mint) || null);
      })
      .catch(() => {
        if (!cancelled) setPosition(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, coin.mint]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    connection
      .getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(coin.mint) })
      .then((res) => {
        if (cancelled) return;
        const decimals = res.value[0]?.account.data.parsed?.info?.tokenAmount?.decimals;
        if (decimals !== undefined) setTokenDecimals(decimals);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, coin.mint]);

  function loadOrders(authToken: string) {
    fetch(`/api/jupiter/trigger/orders?state=active&mint=${coin.mint}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((data: { orders?: TriggerOrder[] }) => {
        setOrders(data.orders || []);
        setOrdersLoaded(true);
      })
      .catch(() => setOrdersLoaded(true));
  }

  if (!connected || !position || position.remainingTokens <= 0) return null;

  async function authenticate(): Promise<string> {
    if (!publicKey || !signMessage) {
      throw new Error("This wallet doesn't support message signing, which the Trigger vault requires.");
    }
    const wallet = publicKey.toBase58();
    const challengeRes = await fetch("/api/jupiter/trigger/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletPubkey: wallet }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok) throw new Error(challenge.error || "Failed to get an auth challenge.");
    if (challenge.type !== "message") throw new Error(t("sltp.noMessageSigning"));

    const signatureBytes = await signMessage(new TextEncoder().encode(challenge.challenge));
    const signature = bs58.encode(signatureBytes);

    const verifyRes = await fetch("/api/jupiter/trigger/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletPubkey: wallet, signature }),
    });
    const verified = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(verified.error || "Failed to verify the signed challenge.");
    setToken(verified.token);
    return verified.token;
  }

  async function refreshOrders() {
    setError("");
    try {
      const authToken = token || (await authenticate());
      loadOrders(authToken);
    } catch (err) {
      setError(explainError(err));
    }
  }

  async function submit() {
    if (!publicKey || !signTransaction) {
      setError(t("sltp.noSigning"));
      setStatus("error");
      return;
    }
    const sl = parseFloat(slPrice);
    const tp = parseFloat(tpPrice);
    const hasSl = slPrice !== "" && sl > 0;
    const hasTp = tpPrice !== "" && tp > 0;
    if (!hasSl && !hasTp) {
      setError(t("sltp.needBoth"));
      setStatus("error");
      return;
    }
    setError("");
    try {
      setStatus("authenticating");
      const wallet = publicKey.toBase58();
      const authToken = await authenticate();

      setStatus("depositing");
      const rawAmount = Math.round(((position!.remainingTokens * amountPct) / 100) * 10 ** tokenDecimals).toString();
      const depositRes = await fetch("/api/jupiter/trigger/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputMint: coin.mint,
          outputMint: SOL_MINT,
          userAddress: wallet,
          amount: rawAmount,
          orderSubType: hasSl && hasTp ? "oco" : "single",
        }),
      });
      const deposit = await depositRes.json();
      if (!depositRes.ok) throw new Error(deposit.error || "Failed to craft the deposit transaction.");

      const depositTx = await signTransaction(base64ToVersionedTransaction(deposit.transaction));
      const depositSignedTx = versionedTransactionToBase64(depositTx);

      setStatus("creating");
      const expiresAt = Date.now() + EXPIRES_IN_MS;
      const orderBody =
        hasSl && hasTp
          ? {
              token: authToken,
              orderType: "oco",
              depositRequestId: deposit.requestId,
              depositSignedTx,
              userPubkey: wallet,
              inputMint: coin.mint,
              inputAmount: rawAmount,
              outputMint: SOL_MINT,
              triggerMint: coin.mint,
              tpPriceUsd: tp,
              slPriceUsd: sl,
              slippageBps: DEFAULT_SLIPPAGE_BPS,
              tpSlippageBps: DEFAULT_SLIPPAGE_BPS,
              slSlippageBps: DEFAULT_SLIPPAGE_BPS,
              expiresAt,
            }
          : {
              token: authToken,
              orderType: "single",
              depositRequestId: deposit.requestId,
              depositSignedTx,
              userPubkey: wallet,
              inputMint: coin.mint,
              inputAmount: rawAmount,
              outputMint: SOL_MINT,
              triggerMint: coin.mint,
              triggerCondition: hasSl ? "below" : "above",
              triggerPriceUsd: hasSl ? sl : tp,
              slippageBps: DEFAULT_SLIPPAGE_BPS,
              expiresAt,
            };

      const orderRes = await fetch("/api/jupiter/trigger/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderBody),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.error || "Failed to create the order.");

      setStatus("done");
      setSlPrice("");
      setTpPrice("");
      loadOrders(authToken);
    } catch (err) {
      setStatus("error");
      setError(explainError(err));
    }
  }

  async function cancelOrder(orderId: string) {
    if (!token || !signTransaction) return;
    setCancelStatus((s) => ({ ...s, [orderId]: "cancelling" }));
    try {
      const craftRes = await fetch(`/api/jupiter/trigger/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const craft = await craftRes.json();
      if (!craftRes.ok) throw new Error(craft.error || "Failed to craft the cancellation.");

      const signedTx = await signTransaction(base64ToVersionedTransaction(craft.transaction));
      const signedTransaction = versionedTransactionToBase64(signedTx);

      const confirmRes = await fetch(`/api/jupiter/trigger/orders/${orderId}/confirm-cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ signedTransaction, cancelRequestId: craft.requestId }),
      });
      const confirmed = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmed.error || "Failed to confirm the cancellation.");

      setOrders((list) => list.filter((o) => o.id !== orderId));
      setCancelStatus((s) => ({ ...s, [orderId]: "idle" }));
    } catch {
      setCancelStatus((s) => ({ ...s, [orderId]: "error" }));
    }
  }

  const busy = status === "authenticating" || status === "depositing" || status === "creating";

  return (
    <div className="rounded-[22px] border border-paper/10 bg-ink-raised p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold">{t("sltp.title")}</span>
        <span className="text-xs text-panda-grey">{open ? t("sltp.hide") : t("sltp.setup")}</span>
      </button>

      {open && (
        <div className="mt-4">
          <p className="rounded-xl border border-meme-orange/30 bg-meme-orange/10 px-3.5 py-3 text-xs leading-relaxed text-paper/85">
            {t("sltp.disclosure", { ticker: coin.ticker })}
          </p>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs font-medium text-paper/80">{t("sltp.activeOrders", { ticker: coin.ticker })}</span>
            <button onClick={refreshOrders} className="text-xs font-semibold text-meme-orange hover:brightness-110">
              {ordersLoaded ? t("sltp.refresh") : t("sltp.show")}
            </button>
          </div>
          {ordersLoaded && orders.length === 0 && <p className="mt-1.5 text-xs text-panda-grey">{t("sltp.noActiveOrders")}</p>}

          {ordersLoaded && orders.length > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-xl bg-ink px-3 py-2 text-xs">
                  <div>
                    <p className="font-medium">
                      {o.orderType === "oco"
                        ? t("sltp.oco")
                        : o.triggerCondition === "below"
                        ? t("sltp.stopLossOrder")
                        : t("sltp.takeProfitOrder")}
                    </p>
                    <p className="text-panda-grey">{o.triggerPriceUsd ? formatUsd(o.triggerPriceUsd) : "—"} · {o.orderState}</p>
                  </div>
                  <button
                    onClick={() => cancelOrder(o.id)}
                    disabled={cancelStatus[o.id] === "cancelling"}
                    className="rounded-lg bg-clay-red/15 px-2.5 py-1.5 font-semibold text-clay-red hover:bg-clay-red/25 disabled:opacity-50"
                  >
                    {cancelStatus[o.id] === "cancelling" ? t("sltp.cancelling") : t("sltp.cancel")}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <span className="mb-1 block text-xs text-panda-grey">{t("sltp.stopLossLabel")}</span>
              <input
                value={slPrice}
                onChange={(e) => setSlPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                disabled={busy}
                className="w-full rounded-xl border border-paper/15 bg-ink px-3 py-2.5 text-sm outline-none focus:border-clay-red/50 disabled:opacity-50"
              />
            </div>
            <div>
              <span className="mb-1 block text-xs text-panda-grey">{t("sltp.takeProfitLabel")}</span>
              <input
                value={tpPrice}
                onChange={(e) => setTpPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                disabled={busy}
                className="w-full rounded-xl border border-paper/15 bg-ink px-3 py-2.5 text-sm outline-none focus:border-bamboo/50 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-panda-grey">{t("sltp.amountOf", { ticker: coin.ticker })}</span>
            <div className="flex gap-1">
              {[25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setAmountPct(pct)}
                  disabled={busy}
                  className={`rounded-lg px-2 py-1 font-semibold transition-colors disabled:opacity-50 ${
                    amountPct === pct ? "bg-paper/15 text-paper" : "bg-paper/5 text-paper/70 hover:bg-paper/10"
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          <p className="mt-2 text-xs text-panda-grey">
            {t("sltp.protects", {
              amount: ((position.remainingTokens * amountPct) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }),
              ticker: coin.ticker,
            })}
          </p>

          <button
            onClick={submit}
            disabled={busy || (!slPrice && !tpPrice)}
            className="mt-3 w-full rounded-xl bg-paper py-3 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "authenticating"
              ? t("sltp.confirmSignIn")
              : status === "depositing"
              ? t("sltp.confirmDeposit")
              : status === "creating"
              ? t("sltp.creatingOrder")
              : status === "done"
              ? t("sltp.orderSet")
              : t("sltp.setOrder")}
          </button>

          {status === "error" && error && <p className="mt-2 text-center text-xs text-clay-red">{error}</p>}
        </div>
      )}
    </div>
  );
}

function explainError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/reject|cancel/i.test(message)) return "You rejected the request in your wallet.";
  if (/insufficient/i.test(message)) return "Insufficient balance to cover this order.";
  if (/expired|blockhash/i.test(message)) return "That step expired — try again.";
  if (/429|too many requests/i.test(message)) return "Jupiter is rate-limiting us — wait a moment and retry.";
  return message.length < 140 ? message : "Failed to set up the order. Please try again.";
}
