"use client";

import { useEffect, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { lamportsToSol, solToLamports } from "@/lib/market/format";
import type { MarketInfo, NftView } from "./types";

type Quote = {
  saleId: string;
  transaction: string;
  kind: "primary" | "secondary";
  name: string;
  split: { price: number; fee: number; royalty: number; seller: number };
};
type Dialog = null | "buy" | "sell";
type Stage = "idle" | "loading" | "signing1" | "signing2" | "confirming" | "pending" | "done";

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Buy / Sell / Cancel controls of one NFT card. Everything shown as a price comes from the server, never computed here. */
export default function MarketActions({ nft, market, onChanged }: { nft: NftView; market: MarketInfo; onChanged: () => void }) {
  const { t } = useLanguage();
  const { connected, publicKey, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const { ensureSession } = useWalletSession();
  const me = publicKey?.toBase58() ?? null;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const quoteAt = useRef(0);
  const [priceText, setPriceText] = useState("");
  const [days, setDays] = useState(7);
  const [preview, setPreview] = useState<{ fee: number; royalty: number; youReceive: number } | null>(null);
  const pendingRef = useRef<{ kind: "buy" | "list"; id: string; signature?: string } | null>(null);

  const errText = (code: string | undefined, fallback?: string) => {
    const key = `mk.err.${code}` as DictKey;
    const tr = code ? t(key) : "";
    return tr && tr !== key ? tr : fallback || t("mk.err.generic");
  };
  const walletError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : "";
    return /reject|cancel|denied/i.test(msg) ? t("mk.rejected") : msg || t("mk.err.generic");
  };

  function close() {
    setDialog(null);
    setStage("idle");
    setError("");
    setNote("");
    setQuote(null);
    setPreview(null);
  }

  // Close on Escape
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stage !== "signing1" && stage !== "signing2" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, stage]);

  const listing = nft.listing;
  const isSeller = !!me && !!listing && listing.seller === me;
  const isOwner = !!me && nft.owner === me;
  const primary = nft.owner === nft.creator && nft.sales === 0;
  const canSell = connected && isOwner && !listing && (primary || market.secondaryEnabled);
  const canBuy = connected && !!listing && !isSeller && listing.expiresAt > Date.now();

  // ---- BUY ------------------------------------------------------------------------------
  async function openBuy() {
    if (!listing) return;
    setError("");
    setDialog("buy");
    setStage("loading");
    try {
      await ensureSession();
      const q = await fetchQuote(listing.listingId);
      setQuote(q);
      setStage("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mk.err.generic"));
      setStage("idle");
    }
  }

  async function fetchQuote(listingId: string): Promise<Quote> {
    const r = await post("/api/market/buy/prepare", { listingId });
    if (!r.ok) throw new Error(errText(r.data.code, r.data.error));
    quoteAt.current = Date.now();
    return { saleId: r.data.saleId, transaction: r.data.transaction, kind: r.data.kind, name: r.data.name, split: r.data.split };
  }

  async function confirmPurchase() {
    if (!quote || !listing) return;
    setError("");
    try {
      let q = quote;
      // The transaction is only valid for about a minute; if the buyer took their time, ask for a fresh one —
      // but never sign different terms than the ones they reviewed.
      if (Date.now() - quoteAt.current > 40_000) {
        setStage("loading");
        const fresh = await fetchQuote(listing.listingId);
        if (JSON.stringify(fresh.split) !== JSON.stringify(quote.split)) {
          setQuote(fresh);
          setStage("idle");
          setError(t("mk.termsChanged"));
          return;
        }
        q = fresh;
        setQuote(fresh);
      }
      setStage("signing1");
      const tx = Transaction.from(b64ToBytes(q.transaction)); // pre-signed by PANDA's market authority; the buyer signs last and pays
      const signature = await sendTransaction(tx, connection, { maxRetries: 3 });
      pendingRef.current = { kind: "buy", id: q.saleId, signature };
      await pollBuy();
    } catch (err) {
      setError(walletError(err));
      setStage("idle");
    }
  }

  async function pollBuy() {
    const p = pendingRef.current;
    if (!p) return;
    setStage("confirming");
    for (let i = 0; i < 30; i++) {
      const r = await post("/api/market/buy/confirm", { saleId: p.id, ...(p.signature ? { signature: p.signature } : {}) });
      if (r.ok) {
        setNote(t("mk.bought"));
        setStage("done");
        onChanged();
        return;
      }
      if (r.status !== 202) {
        setError(errText(r.data.code, r.data.error));
        setStage("idle");
        return;
      }
      await sleep(3000);
    }
    setStage("pending");
  }

  // ---- SELL -----------------------------------------------------------------------------
  const lamports = solToLamports(priceText);

  async function startSell() {
    if (lamports === null || !signMessage) {
      setError(lamports === null ? t("mk.err.BAD_TERMS") : t("auth.noSign"));
      return;
    }
    setError("");
    setStage("signing1");
    try {
      await ensureSession();
      const prep = await post("/api/market/list/prepare", { contentId: nft.contentId, priceLamports: lamports, expiresAt: Date.now() + days * 86_400_000 });
      if (!prep.ok) throw new Error(errText(prep.data.code, prep.data.error));
      setPreview({ fee: prep.data.preview.fee, royalty: prep.data.preview.royalty, youReceive: prep.data.preview.youReceive });

      // 1) sign the exact terms (free)   2) approve PANDA's market to move this NFT if it sells (on-chain)
      const messageSignature = bs58.encode(await signMessage(new TextEncoder().encode(prep.data.message)));
      setStage("signing2");
      await sendTransaction(Transaction.from(b64ToBytes(prep.data.transaction)), connection, { maxRetries: 3 });

      pendingRef.current = { kind: "list", id: prep.data.listingId, signature: messageSignature };
      await pollList();
    } catch (err) {
      setError(walletError(err));
      setStage("idle");
    }
  }

  async function pollList() {
    const p = pendingRef.current;
    if (!p) return;
    setStage("confirming");
    for (let i = 0; i < 30; i++) {
      const r = await post("/api/market/list/confirm", { listingId: p.id, messageSignature: p.signature });
      if (r.ok) {
        setNote(t("mk.nowListed"));
        setStage("done");
        onChanged();
        return;
      }
      if (r.status !== 202) {
        setError(errText(r.data.code, r.data.error));
        setStage("idle");
        return;
      }
      await sleep(3000);
    }
    setStage("pending");
  }

  // ---- CANCEL ---------------------------------------------------------------------------
  async function cancel() {
    if (!listing) return;
    setError("");
    setStage("loading");
    try {
      const r = await post("/api/market/cancel", { listingId: listing.listingId });
      if (!r.ok) throw new Error(errText(r.data.code, r.data.error));
      onChanged(); // the listing is already stopped; taking the approval back on-chain is a tidy-up the seller can decline
      if (r.data.transaction) {
        try {
          await sendTransaction(Transaction.from(b64ToBytes(r.data.transaction)), connection, { maxRetries: 3 });
        } catch {
          /* declined: the listing is cancelled either way */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mk.err.generic"));
    }
    setStage("idle");
  }

  if (!market.enabled) return null;

  const busy = stage === "loading" || stage === "signing1" || stage === "signing2" || stage === "confirming";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 px-3.5 pb-3">
        {listing ? (
          <>
            <span className="min-w-0 truncate text-sm font-semibold">
              ◎ {lamportsToSol(listing.priceLamports)}
              <span className="ml-1.5 rounded-full bg-bamboo/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bamboo">{t("mk.forSale")}</span>
            </span>
            {canBuy && (
              <button onClick={openBuy} disabled={busy} className={BTN_PRIMARY}>
                {t("mk.buy")}
              </button>
            )}
            {isSeller && (
              <button onClick={cancel} disabled={busy} className={BTN_GHOST}>
                {t("mk.cancel")}
              </button>
            )}
          </>
        ) : canSell ? (
          <button onClick={() => setDialog("sell")} className={BTN_GHOST}>
            {t("mk.sell")}
          </button>
        ) : null}
      </div>
      {error && !dialog && <p className="px-3.5 pb-3 text-xs text-clay-red">{error}</p>}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[24px] border border-paper/10 bg-ink-raised p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={nft.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-bold tracking-tight">{dialog === "buy" ? t("mk.confirmBuyTitle") : t("mk.sellTitle")}</h2>
                <p className="truncate text-sm text-panda-grey">{nft.name}</p>
              </div>
            </div>

            {dialog === "buy" && (
              <div className="mt-5">
                {quote ? (
                  <>
                    <p className="mb-2 text-xs text-panda-grey">{quote.kind === "primary" ? t("mk.primary") : t("mk.secondary")}</p>
                    <ul className="space-y-1.5 text-sm">
                      <Row label={t("mk.toSeller")} value={quote.split.seller} />
                      {quote.split.royalty > 0 && <Row label={t("mk.toCreator")} value={quote.split.royalty} />}
                      <Row label={t("mk.toPanda", { pct: market.feeBps / 100 })} value={quote.split.fee} />
                      <li className="flex items-center justify-between rounded-xl bg-ink px-3.5 py-3 font-semibold">
                        <span>{t("mk.youPay")}</span>
                        <span>◎ {lamportsToSol(quote.split.price)}</span>
                      </li>
                    </ul>
                    <p className="mt-3 text-xs text-panda-grey">{t("mk.networkNote")}</p>
                  </>
                ) : stage === "loading" ? (
                  <div className="h-24 animate-pulse rounded-2xl bg-ink" aria-hidden />
                ) : null}
              </div>
            )}

            {dialog === "sell" && stage !== "done" && (
              <div className="mt-5">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("mk.priceSol")}</span>
                  <input
                    value={priceText}
                    onChange={(e) => setPriceText(e.target.value)}
                    inputMode="decimal"
                    placeholder="1.5"
                    disabled={busy}
                    className="w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
                  />
                </label>
                <div className="mt-4">
                  <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("mk.duration")}</span>
                  <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-ink p-1.5">
                    {[1, 7, 30].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDays(d)}
                        disabled={busy}
                        className={`rounded-xl py-2 text-xs font-semibold transition-colors ${days === d ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
                      >
                        {t("mk.days", { n: d })}
                      </button>
                    ))}
                  </div>
                </div>
                {preview && (
                  <ul className="mt-4 space-y-1.5 text-sm">
                    <Row label={t("mk.toPanda", { pct: market.feeBps / 100 })} value={preview.fee} />
                    {preview.royalty > 0 && <Row label={t("mk.toCreator")} value={preview.royalty} />}
                    <Row label={t("mk.youReceive")} value={preview.youReceive} strong />
                  </ul>
                )}
                <p className="mt-4 text-xs text-panda-grey">{t("mk.sellNote")}</p>
              </div>
            )}

            {stage === "signing1" && dialog === "sell" && <Status text={t("mk.sign1")} />}
            {stage === "signing2" && <Status text={t("mk.sign2")} />}
            {stage === "signing1" && dialog === "buy" && <Status text={t("mk.buying")} />}
            {stage === "confirming" && <Status text={t("mk.confirming")} />}
            {stage === "pending" && <p className="mt-4 text-sm text-panda-grey">{t("mk.pending")}</p>}
            {stage === "done" && <p className="mt-5 font-display text-lg font-bold text-bamboo">{note}</p>}
            {error && <p className="mt-4 text-sm text-clay-red" role="alert">{error}</p>}

            <div className="mt-6 grid grid-cols-2 gap-2">
              <button type="button" onClick={close} disabled={stage === "signing1" || stage === "signing2"} className="rounded-full border border-paper/20 py-3 text-sm font-semibold transition-colors hover:border-paper/40 disabled:opacity-40">
                {stage === "done" ? t("mk.close") : t("mk.back")}
              </button>
              {stage === "pending" ? (
                <button type="button" onClick={() => (pendingRef.current?.kind === "list" ? pollList() : pollBuy())} className="rounded-full bg-paper py-3 text-sm font-semibold text-ink transition hover:brightness-90">
                  {t("mk.checkAgain")}
                </button>
              ) : dialog === "buy" && stage !== "done" ? (
                <button type="button" onClick={confirmPurchase} disabled={!quote || busy} className="rounded-full bg-paper py-3 text-sm font-semibold text-ink transition hover:brightness-90 disabled:opacity-40">
                  {t("mk.confirmBuy")}
                </button>
              ) : dialog === "sell" && stage !== "done" ? (
                <button type="button" onClick={startSell} disabled={lamports === null || busy} className="rounded-full bg-paper py-3 text-sm font-semibold text-ink transition hover:brightness-90 disabled:opacity-40">
                  {t("mk.sellGo")}
                </button>
              ) : (
                <span />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const BTN_PRIMARY = "shrink-0 rounded-full bg-paper px-4 py-1.5 text-xs font-semibold text-ink transition hover:brightness-90 disabled:opacity-50";
const BTN_GHOST = "shrink-0 rounded-full border border-paper/20 px-4 py-1.5 text-xs font-semibold transition-colors hover:border-paper/40 disabled:opacity-50";

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <li className={`flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5 ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-panda-grey"}>{label}</span>
      <span>◎ {lamportsToSol(value)}</span>
    </li>
  );
}

function Status({ text }: { text: string }) {
  return (
    <p className="mt-5 flex items-center gap-2.5 text-sm text-paper/80" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper/20 border-t-paper" aria-hidden />
      {text}
    </p>
  );
}
