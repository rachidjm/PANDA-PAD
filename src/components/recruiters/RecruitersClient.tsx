"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";
import WalletButton from "@/components/WalletButton";
import CopyReferralLink from "./CopyReferralLink";
import SetRecruiterCode from "./SetRecruiterCode";
import ApplyRecruiterCode from "./ApplyRecruiterCode";
import { useCurrency } from "@/components/portfolio/useCurrency";
import { formatMoney } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DEFAULT_REFERRAL_MIN_DAILY_VOLUME_SOL, DEFAULT_REFERRAL_TIERS, FOUNDER_SHARE_BPS } from "@/lib/referrals/tiers-config";

type Stats = { referredCount: number; earnedLamports: number; solUsd: number | null; eurUsd: number | null; founder: { rank: number } | null; founderSlotsLeft: number };
type Invitee = { wallet: string; boundAt: number; active: boolean; everActivated: boolean; streakDays: number; earnedLamports: number };
type LoadState = "loading" | "ready" | "error";

const pct = (bps: number) => `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

export default function RecruitersClient() {
  const { connected, publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  return connected && address ? <LoggedIn address={address} /> : <LoggedOut />;
}

function LoggedOut() {
  const { t } = useLanguage();
  const [slotsLeft, setSlotsLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/referrals/founders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { slotsLeft?: number } | null) => {
        if (!cancelled && d) setSlotsLeft(d.slotsLeft ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="text-center">
        <Panda pose="success" size={88} />
        <h1 className="mt-4 font-display text-3xl font-bold leading-tight sm:text-4xl">{t("rec.heroTitle")}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-panda-grey sm:text-base">{t("rec.heroSubtitle")}</p>
        <div className="mt-6">
          <WalletButton />
        </div>
      </div>

      <section className="mt-12 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <h2 className="font-display text-lg font-bold">{t("rec.howItWorks")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[t("rec.step1"), t("rec.step2"), t("rec.step3")].map((step, i) => (
            <div key={i} className="rounded-2xl bg-paper/[0.04] p-4">
              <span className="font-display text-2xl font-bold text-meme-orange">{i + 1}</span>
              <p className="mt-1.5 text-sm">{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-[24px] border border-bamboo/30 bg-bamboo/[0.06] p-6">
        <h2 className="font-display text-lg font-bold text-bamboo">{t("rec.foundersTitle")}</h2>
        <p className="mt-1.5 font-display text-2xl font-bold">{slotsLeft !== null ? t("rec.foundersLeft", { n: slotsLeft }) : "…"}</p>
        <p className="mt-2 text-sm text-panda-grey">{t("rec.foundersNote")}</p>
      </section>

      <section className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <h2 className="font-display text-lg font-bold">{t("rec.tiersTitle")}</h2>
        <p className="mt-1 text-xs text-panda-grey">{t("rec.tiersNote")}</p>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {DEFAULT_REFERRAL_TIERS.map((tier, i) => {
              const from = i === 0 ? 1 : (DEFAULT_REFERRAL_TIERS[i - 1].upTo ?? 0) + 1;
              return (
                <tr key={i} className="border-t border-paper/10 first:border-t-0">
                  <td className="py-2.5 text-panda-grey">{tier.upTo === null ? `${from}+` : `${from}–${tier.upTo}`}</td>
                  <td className="py-2.5 text-right font-semibold">{pct(tier.bps)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <h2 className="font-display text-lg font-bold">{t("rec.faqTitle")}</h2>
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-sm font-semibold">{t("rec.faqActiveQ")}</p>
            <p className="mt-1 text-sm text-panda-grey">{t("rec.faqActiveA", { min: DEFAULT_REFERRAL_MIN_DAILY_VOLUME_SOL })}</p>
          </div>
          <div>
            <p className="text-sm font-semibold">{t("rec.faqPayQ")}</p>
            <p className="mt-1 text-sm text-panda-grey">{t("rec.faqPayA")}</p>
          </div>
          <div>
            <p className="text-sm font-semibold">{t("rec.faqAbuseQ")}</p>
            <p className="mt-1 text-sm text-panda-grey">{t("rec.faqAbuseA")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function LoggedIn({ address }: { address: string }) {
  const { t, lang } = useLanguage();
  const { currency, setCurrency, eurUsd: liveEurUsd } = useCurrency(lang);

  const [state, setState] = useState<LoadState>("loading");
  const [stats, setStats] = useState<Stats | null>(null);
  const [invitees, setInvitees] = useState<Invitee[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setState("loading");
    });
    Promise.all([
      fetch(`/api/referrals/stats?wallet=${address}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats")))),
      fetch(`/api/referrals/invitees?wallet=${address}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("invitees")))),
    ])
      .then(([statsData, inviteesData]: [Stats, { invitees: Invitee[] }]) => {
        if (cancelled) return;
        setStats(statsData);
        setInvitees(inviteesData.invitees);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const eurUsd = currency === "EUR" ? (stats?.eurUsd ?? liveEurUsd) : liveEurUsd;
  const money = (usd: number) => {
    if (currency === "EUR" && eurUsd === null) return "…";
    return formatMoney(currency === "EUR" ? usd / (eurUsd as number) : usd, currency, lang);
  };
  const earnedSol = stats ? stats.earnedLamports / 1e9 : 0;
  const earnedUsd = stats?.solUsd !== null && stats?.solUsd !== undefined ? earnedSol * stats.solUsd : null;
  const activeCount = invitees?.filter((i) => i.active).length ?? 0;

  function shareText() {
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${address}`;
    return `${t("rec.shareText")} ${link}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("rec.title")}</h1>
          {stats?.founder && <p className="mt-1 text-sm font-semibold text-bamboo">{t("rec.founderBadge", { n: stats.founder.rank })}</p>}
        </div>
        <Panda pose={state === "ready" ? "success" : "idle"} size={72} />
      </div>

      <section className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-xs text-panda-grey">{t("rec.yourLink")}</p>
        <CopyReferralLink wallet={address} className="mt-2" />
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText())}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-paper/10 px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-paper/15"
          >
            {t("rec.shareX")}
          </a>
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${address}`)}&text=${encodeURIComponent(t("rec.shareText"))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-paper/10 px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-paper/15"
          >
            {t("rec.shareTelegram")}
          </a>
        </div>
        <SetRecruiterCode wallet={address} />
      </section>

      <ApplyRecruiterCode wallet={address} className="mt-4 rounded-[24px] border border-paper/10 bg-ink-raised p-6" />

      {state === "error" && <p className="mt-4 text-sm text-clay-red">{t("rec.readError")}</p>}

      {state !== "error" && (
        <>
          <section className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-paper/[0.04] p-4">
              <p className="text-xs text-panda-grey">{t("rec.referred")}</p>
              <p className="mt-1.5 font-display text-xl font-bold">{state === "loading" ? "…" : (stats?.referredCount ?? 0)}</p>
            </div>
            <div className="rounded-2xl bg-paper/[0.04] p-4">
              <p className="text-xs text-panda-grey">{t("rec.active")}</p>
              <p className="mt-1.5 font-display text-xl font-bold">{state === "loading" ? "…" : activeCount}</p>
            </div>
            <div className="rounded-2xl bg-paper/[0.04] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-panda-grey">{t("rec.earnedTotal")}</p>
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
          </section>

          {stats?.founder && (
            <section className="mt-4 rounded-2xl border border-bamboo/30 bg-bamboo/[0.06] p-4">
              <p className="text-sm font-semibold text-bamboo">{t("rec.founderBadge", { n: stats.founder.rank })} — {pct(FOUNDER_SHARE_BPS)}</p>
            </section>
          )}

          <section className="mt-6">
            <h2 className="font-display text-lg font-bold">{t("rec.inviteesTitle")}</h2>
            {state === "loading" ? (
              <p className="mt-3 text-sm text-panda-grey">…</p>
            ) : !invitees || invitees.length === 0 ? (
              <p className="mt-3 text-sm text-panda-grey">{t("rec.inviteesEmpty")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-paper/10 overflow-hidden rounded-2xl border border-paper/10">
                {invitees.map((inv) => (
                  <li key={inv.wallet} className="flex items-center justify-between gap-3 bg-ink-raised px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-paper/80">{short(inv.wallet)}</p>
                      <p className="mt-0.5 text-[11px] text-panda-grey">
                        {inv.active ? t("rec.statusActive") : inv.everActivated ? t("rec.statusInactive") : t("rec.statusProgress", { n: Math.min(2, inv.streakDays) })}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs font-semibold text-paper/80">{(inv.earnedLamports / 1e9).toLocaleString(lang, { maximumFractionDigits: 4 })} SOL</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
