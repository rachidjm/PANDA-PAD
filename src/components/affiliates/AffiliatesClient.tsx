"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";
import WalletButton from "@/components/WalletButton";
import CopyReferralLink from "./CopyReferralLink";
import { useCurrency } from "@/components/portfolio/useCurrency";
import { formatMoney } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Stats = { referredCount: number; earnedLamports: number; solUsd: number | null; eurUsd: number | null; campaign: { start: number; end: number } | null; daysLeft: number | null };
type LoadState = "loading" | "ready" | "error";

export default function AffiliatesClient() {
  const { connected, publicKey } = useWallet();
  const { t, lang } = useLanguage();
  const { currency, setCurrency, eurUsd: liveEurUsd } = useCurrency(lang);
  const address = publicKey?.toBase58() ?? null;

  const [state, setState] = useState<LoadState>("loading");
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setState("loading");
    });
    fetch(`/api/referrals/stats?wallet=${address}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats"))))
      .then((data: Stats) => {
        if (!cancelled) {
          setStats(data);
          setState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!connected || !address) {
    return (
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h1 className="font-display text-xl font-bold">{t("aff.title")}</h1>
            <p className="mt-1 text-sm text-panda-grey">{t("aff.connectPrompt")}</p>
            <div className="mt-4">
              <WalletButton />
            </div>
          </div>
          <Panda pose="empty" size={80} />
        </div>
      </div>
    );
  }

  const eurUsd = currency === "EUR" ? (stats?.eurUsd ?? liveEurUsd) : liveEurUsd;
  const money = (usd: number) => {
    if (currency === "EUR" && eurUsd === null) return "…";
    return formatMoney(currency === "EUR" ? usd / (eurUsd as number) : usd, currency, lang);
  };
  const earnedSol = stats ? stats.earnedLamports / 1e9 : 0;
  const earnedUsd = stats?.solUsd !== null && stats?.solUsd !== undefined ? earnedSol * stats.solUsd : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("aff.title")}</h1>
          <p className="mt-1 text-sm text-panda-grey">{t("aff.intro")}</p>
        </div>
        <Panda pose={state === "ready" ? "success" : "idle"} size={72} />
      </div>

      <section className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-xs text-panda-grey">{t("aff.yourLink")}</p>
        <CopyReferralLink wallet={address} className="mt-2" />
        <p className="mt-3 text-[11px] leading-relaxed text-panda-grey">{t("aff.howItWorks")}</p>
      </section>

      {state === "error" && <p className="mt-4 text-sm text-clay-red">{t("aff.readError")}</p>}

      {state !== "error" && (
        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-paper/[0.04] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-panda-grey">{t("aff.referred")}</p>
            </div>
            <p className="mt-1.5 font-display text-xl font-bold">{state === "loading" ? "…" : (stats?.referredCount ?? 0)}</p>
          </div>

          <div className="rounded-2xl bg-paper/[0.04] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-panda-grey">{t("aff.earned")}</p>
              <div className="flex shrink-0 gap-0.5 rounded-full bg-paper/[0.06] p-0.5" role="group" aria-label={t("pf.currencyAria")}>
                {(["EUR", "USD"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
                    aria-pressed={currency === c}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${currency === c ? "bg-paper text-ink" : "text-panda-grey hover:text-paper"}`}
                  >
                    {c === "EUR" ? "€" : "$"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1.5 font-display text-xl font-bold leading-tight">
              {state === "loading" ? "…" : earnedUsd !== null ? money(earnedUsd) : `${earnedSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL`}
            </p>
            {state === "ready" && <p className="mt-1 text-xs text-panda-grey">{earnedSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL</p>}
          </div>

          <div className="rounded-2xl bg-paper/[0.04] p-4">
            <p className="text-xs text-panda-grey">{t("aff.campaign")}</p>
            <p className="mt-1.5 font-display text-xl font-bold leading-tight">
              {state === "loading" ? "…" : stats?.daysLeft !== null && stats?.daysLeft !== undefined ? t("aff.daysLeft", { n: stats.daysLeft }) : t("aff.campaignClosed")}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
