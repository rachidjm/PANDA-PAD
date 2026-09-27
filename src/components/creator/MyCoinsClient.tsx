"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";
import WalletButton from "@/components/WalletButton";
import CoinAvatar from "@/components/CoinAvatar";
import { confirmSignature } from "@/lib/solana/confirm";
import { base64ToTransaction } from "@/lib/pump/wire";
import { formatCompact, formatPrice } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useCurrency } from "@/components/portfolio/useCurrency";

type CreatorCoin = {
  mint: string;
  ticker: string;
  name: string;
  image?: string;
  price: number | null;
  marketCap: number;
  volume24h: number;
  holders: number | null;
  pendingFeeLamports: number | null;
};
type CoinsResponse = { coins: CreatorCoin[]; truncated: boolean; solUsd: number | null; eurUsd: number | null };
type LoadState = "loading" | "ready" | "error";
type CollectState = "idle" | "building" | "signing" | "confirming" | "done" | "error";

type AffStats = { referredCount: number; earnedLamports: number; solUsd: number | null; daysLeft: number | null };

function collectButtonLabel(cs: CollectState, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (cs) {
    case "building":
      return t("mine.collect.building");
    case "signing":
      return t("mine.collect.signing");
    case "confirming":
      return t("mine.collect.confirming");
    case "done":
      return t("mine.collect.done");
    default:
      return t("mine.collect");
  }
}

export default function MyCoinsClient() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { t, lang } = useLanguage();
  const { referrals } = useFeatures();
  const { currency, setCurrency, eurUsd: liveEurUsd } = useCurrency(lang);
  const address = publicKey?.toBase58() ?? null;

  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<CoinsResponse | null>(null);
  const [collect, setCollect] = useState<Record<string, { state: CollectState; error?: string }>>({});
  const [aff, setAff] = useState<AffStats | "loading" | "error" | null>(null);

  const load = useCallback(() => {
    if (!address) return;
    setState("loading");
    fetch(`/api/creator/coins?wallet=${address}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("coins"))))
      .then((d: CoinsResponse) => {
        setData(d);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [address]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!address || !referrals) return;
    setAff("loading");
    fetch(`/api/referrals/stats?wallet=${address}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("aff"))))
      .then((d: AffStats) => setAff(d))
      .catch(() => setAff("error"));
  }, [address, referrals]);

  async function onCollect(mint: string) {
    if (!publicKey) return;
    setCollect((c) => ({ ...c, [mint]: { state: "building" } }));
    try {
      const buildRes = await fetch("/api/pump/collect-fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint, user: publicKey.toBase58() }),
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || t("mine.err.build"));

      setCollect((c) => ({ ...c, [mint]: { state: "signing" } }));
      const tx = base64ToTransaction(buildData.transaction);
      const sig = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });

      setCollect((c) => ({ ...c, [mint]: { state: "confirming" } }));
      await confirmSignature(connection, sig);

      setCollect((c) => ({ ...c, [mint]: { state: "done" } }));
      load(); // real numbers, re-read from chain rather than guessed locally
    } catch (err) {
      setCollect((c) => ({ ...c, [mint]: { state: "error", error: err instanceof Error ? err.message : t("mine.err.build") } }));
    }
  }

  if (!connected || !address) {
    return (
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h1 className="font-display text-xl font-bold">{t("mine.title")}</h1>
            <p className="mt-1 text-sm text-panda-grey">{t("mine.connectPrompt")}</p>
            <div className="mt-4">
              <WalletButton />
            </div>
          </div>
          <Panda pose="empty" size={80} />
        </div>
      </div>
    );
  }

  const eurUsd = liveEurUsd;
  const money = (usd: number) => {
    if (currency === "EUR" && eurUsd === null) return "…";
    return new Intl.NumberFormat(lang, { style: "currency", currency }).format(currency === "EUR" ? usd / (eurUsd as number) : usd);
  };
  const coins = data?.coins ?? [];
  const solUsd = data?.solUsd ?? null;
  const totalPendingLamports = coins.reduce((s, c) => s + (c.pendingFeeLamports ?? 0), 0);
  const totalPendingSol = totalPendingLamports / 1e9;
  const totalPendingUsd = solUsd !== null ? totalPendingSol * solUsd : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("mine.title")}</h1>
          <p className="mt-1 text-sm text-panda-grey">{t("mine.intro")}</p>
        </div>
        <Panda pose={state === "ready" ? "success" : "idle"} size={72} />
      </div>

      <section className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-panda-grey">{t("mine.pendingTotal")}</p>
          <div className="flex shrink-0 gap-0.5 rounded-full bg-paper/[0.06] p-0.5" role="group" aria-label={t("pf.currencyAria")}>
            {(["EUR", "USD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                aria-pressed={currency === c}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${currency === c ? "bg-paper text-ink" : "text-panda-grey hover:text-paper"}`}
              >
                {c === "EUR" ? "€" : "$"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 font-display text-3xl font-bold">{state === "loading" ? "…" : totalPendingUsd !== null ? money(totalPendingUsd) : "—"}</p>
        <p className="mt-1 text-sm text-panda-grey">{totalPendingSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL</p>
        <p className="mt-3 text-[11px] leading-relaxed text-panda-grey">{t("mine.pendingNote")}</p>
      </section>

      {referrals && (
        <section className="mt-4 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
          <p className="text-xs text-panda-grey">{t("aff.earned")}</p>
          {aff === "loading" || aff === null ? (
            <p className="mt-1.5 font-display text-xl font-bold text-panda-grey">…</p>
          ) : aff === "error" ? (
            <p className="mt-1.5 text-sm text-panda-grey">{t("aff.readError")}</p>
          ) : (
            <>
              <p className="mt-1.5 font-display text-xl font-bold">{(aff.earnedLamports / 1e9).toLocaleString(lang, { maximumFractionDigits: 4 })} SOL</p>
              <p className="mt-1 text-xs text-panda-grey">
                {t("aff.referred")}: {aff.referredCount} · {aff.daysLeft !== null ? t("aff.daysLeft", { n: aff.daysLeft }) : t("aff.campaignClosed")}
              </p>
            </>
          )}
          <Link href="/affiliates" className="mt-2 inline-block text-xs font-medium text-meme-orange hover:underline">
            {t("aff.shareCoinLink")}
          </Link>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-bold">{t("mine.coins")}</h2>
        {state === "error" && <p className="mt-3 text-sm text-clay-red">{t("mine.err.read")}</p>}
        <div className="mt-3 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
          {state === "loading" && (
            <div className="space-y-1.5 p-4">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-paper/5" />
              ))}
            </div>
          )}
          {state === "ready" && coins.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm text-panda-grey">{t("mine.empty")}</p>
              <Link href="/create" className="mt-3 inline-block rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink hover:brightness-90 transition">
                {t("mine.createOne")}
              </Link>
            </div>
          )}
          {state === "ready" &&
            coins.map((c) => {
              const cs = collect[c.mint]?.state ?? "idle";
              const pendingSol = (c.pendingFeeLamports ?? 0) / 1e9;
              const canCollect = (c.pendingFeeLamports ?? 0) > 0 && cs !== "building" && cs !== "signing" && cs !== "confirming";
              return (
                <div key={c.mint} className="p-4">
                  <div className="flex items-center gap-3">
                    <Link href={`/coin/${c.mint}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                        <CoinAvatar image={c.image} ticker={c.ticker} mint={c.mint} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">${c.ticker}</p>
                        <p className="text-xs text-panda-grey">
                          {c.price !== null ? formatPrice(c.price) : t("pf.noPrice")} · {t("mine.mcap")} {formatCompact(c.marketCap)}
                        </p>
                      </div>
                    </Link>
                    <div className="shrink-0 text-right">
                      <p className="font-medium">{pendingSol > 0 ? `${pendingSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL` : "—"}</p>
                      <p className="text-xs text-panda-grey">{t("mine.pending")}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-panda-grey">
                    <span>
                      {t("mine.holders")}: {c.holders ?? "—"} · {t("mine.vol24h")} {formatCompact(c.volume24h)}
                      {c.pendingFeeLamports === null && <> · {t("mine.noFeeSplit")}</>}
                    </span>
                    <button
                      type="button"
                      disabled={!canCollect}
                      onClick={() => onCollect(c.mint)}
                      className="shrink-0 rounded-full bg-meme-orange px-3 py-1.5 text-xs font-semibold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {collectButtonLabel(cs, t)}
                    </button>
                  </div>
                  {cs === "error" && <p className="mt-1.5 text-xs text-clay-red">{collect[c.mint]?.error}</p>}
                </div>
              );
            })}
        </div>
        {data?.truncated && <p className="mt-3 text-xs text-panda-grey">{t("mine.truncated")}</p>}
      </section>
    </div>
  );
}
