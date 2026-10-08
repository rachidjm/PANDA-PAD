"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Panda from "@/components/panda/Panda";
import WalletButton from "@/components/WalletButton";
import CopyReferralLink from "./CopyReferralLink";
import SetRecruiterCode from "./SetRecruiterCode";
import ApplyRecruiterCode from "./ApplyRecruiterCode";
import InviterLine from "@/components/referrals/InviterLine";
import { useCurrency } from "@/components/portfolio/useCurrency";
import { formatMoney } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { siteUrl } from "@/lib/config/site";
import {
  bpsForRank,
  DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD,
  DEFAULT_FOUNDER_REQUIRED_TRADERS,
  DEFAULT_REFERRAL_MIN_DAILY_VOLUME_SOL,
  DEFAULT_REFERRAL_TIERS,
  DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD,
  FOUNDER_SHARE_BPS,
} from "@/lib/referrals/tiers-config";
import { isPeriodKey, type PeriodKey } from "@/lib/referrals/period";
import { averageEarnedLamports, filterInvitees, INVITEE_FILTER_STATES, INVITEE_SORT_KEYS, sortInvitees, type Invitee, type InviteeFilterState, type InviteeSortKey } from "./filterInvitees";

type Stats = {
  referredCount: number;
  earnedLamports: number;
  solUsd: number | null;
  eurUsd: number | null;
  founder: { rank: number } | null;
  founderSlotsLeft: number;
  validInviteeCount: number;
  founderRequiredTraders: number;
  founderMinTraderVolumeUsd: number;
  period: { earnedLamports: number; bestDay: { day: string; lamports: number } | null; topInvitee: { wallet: string; lamports: number } | null; previousEarnedLamports: number | null };
};
type PayoutRow = { signature: string; referred: string; mint: string; lamports: number; ts: number };
type LoadState = "loading" | "ready" | "error";

const pct = (bps: number) => `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
const STATE_CLASS: Record<Invitee["state"], string> = { bound: "text-bamboo", pending: "text-meme-orange", rejected: "text-clay-red" };
const PAGE_SIZE = 20;

/** A labelled progress bar: how far an invitee is toward one requirement (trader-active or Founder-valid). */
function ProgressBar({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  return (
    <div className="mt-2">
      <div className="flex justify-between gap-2 text-[11px] text-panda-grey">
        <span>{label}</span>
        <span className="font-medium text-paper/80">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper/10">
        <div className="h-full rounded-full bg-bamboo transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }} />
      </div>
    </div>
  );
}

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
        <p className="mx-auto mt-3 inline-block rounded-full bg-bamboo/[0.08] px-4 py-1.5 text-sm font-semibold text-bamboo">
          {t("rec.halfPriceBlock", { min: DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD })}
        </p>
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
        <p className="mt-2 text-sm text-panda-grey">
          {t("rec.foundersNote", { n: DEFAULT_FOUNDER_REQUIRED_TRADERS, min: DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD })}
        </p>
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
          <div>
            <p className="text-sm font-semibold">{t("rec.faqFounderQ")}</p>
            <p className="mt-1 text-sm text-panda-grey">
              {t("rec.faqFounderA", { n: DEFAULT_FOUNDER_REQUIRED_TRADERS, min: DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD })}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Reads/writes one filter param in the URL — `?period=7d&state=active&q=...&sort=earned` — so a filtered view
 *  can be bookmarked or shared exactly as it looks. Changing a filter clears `page` (a stale page number makes
 *  no sense once what it was paging through has changed). */
function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const stateParam = searchParams.get("state");
  const sortParam = searchParams.get("sort");
  const period: PeriodKey = isPeriodKey(periodParam) ? periodParam : "all";
  const stateFilter: InviteeFilterState = (INVITEE_FILTER_STATES as readonly string[]).includes(stateParam ?? "") ? (stateParam as InviteeFilterState) : "all";
  const sort: InviteeSortKey = (INVITEE_SORT_KEYS as readonly string[]).includes(sortParam ?? "") ? (sortParam as InviteeSortKey) : "default";
  const q = searchParams.get("q") ?? "";

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === "all" || v === "default") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );
  const clear = useCallback(() => router.replace(pathname, { scroll: false }), [router, pathname]);

  return { period, stateFilter, sort, q, setParams, clear, hasAny: !!(periodParam || stateParam || sortParam || q) };
}

function LoggedIn({ address }: { address: string }) {
  const { t, lang } = useLanguage();
  const { currency, setCurrency, eurUsd: liveEurUsd } = useCurrency(lang);
  const { period, stateFilter, sort, q, setParams, clear, hasAny } = useUrlFilters();

  const [state, setState] = useState<LoadState>("loading");
  const [stats, setStats] = useState<Stats | null>(null);
  const [invitees, setInvitees] = useState<Invitee[] | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setState("loading");
    });
    Promise.all([
      fetch(`/api/referrals/stats?wallet=${address}&period=${period}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats")))),
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
  }, [address, period]);

  // The filter bar narrows what's already loaded (one wallet's invitees is small enough to filter/sort right
  // here); "Mostrar más" just reveals more of that SAME filtered-and-sorted list, reset whenever it changes.
  const founderMin = stats?.founderMinTraderVolumeUsd ?? DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD;
  const filteredInvitees = useMemo(() => (invitees ? sortInvitees(filterInvitees(invitees, { state: stateFilter, q }, founderMin), sort) : []), [invitees, stateFilter, q, sort, founderMin]);
  useEffect(() => {
    Promise.resolve().then(() => setVisibleCount(PAGE_SIZE));
  }, [stateFilter, q, sort]);
  const visibleInvitees = filteredInvitees.slice(0, visibleCount);
  const avgEarnedLamports = useMemo(() => (invitees ? averageEarnedLamports(invitees) : 0), [invitees]);

  // Payment history: server-filtered/paginated by the SAME period + search (a wallet search doubles as "payments from this invitee").
  const [payouts, setPayouts] = useState<PayoutRow[] | null>(null);
  const [payoutsTotal, setPayoutsTotal] = useState(0);
  const [payoutsPage, setPayoutsPage] = useState(1);
  useEffect(() => {
    Promise.resolve().then(() => setPayoutsPage(1));
  }, [period, q]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ wallet: address, period, limit: String(PAGE_SIZE), offset: String((payoutsPage - 1) * PAGE_SIZE) });
    if (q) params.set("q", q);
    fetch(`/api/referrals/payouts?${params.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { payouts: PayoutRow[]; total: number } | null) => {
        if (cancelled || !d) return;
        setPayouts(d.payouts);
        setPayoutsTotal(d.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address, period, q, payoutsPage]);
  const csvHref = useMemo(() => {
    const params = new URLSearchParams({ wallet: address, period, format: "csv" });
    if (q) params.set("q", q);
    return `/api/referrals/payouts?${params.toString()}`;
  }, [address, period, q]);

  const eurUsd = currency === "EUR" ? (stats?.eurUsd ?? liveEurUsd) : liveEurUsd;
  const money = (usd: number) => {
    if (currency === "EUR" && eurUsd === null) return "…";
    return formatMoney(currency === "EUR" ? usd / (eurUsd as number) : usd, currency, lang);
  };
  const solAmount = (lamports: number) => (lamports / 1e9).toLocaleString(lang, { maximumFractionDigits: 4 });
  const earnedSol = stats ? stats.earnedLamports / 1e9 : 0;
  const earnedUsd = stats?.solUsd !== null && stats?.solUsd !== undefined ? earnedSol * stats.solUsd : null;
  const activeCount = invitees?.filter((i) => i.active).length ?? 0;
  const currentTierBps = stats?.founder ? FOUNDER_SHARE_BPS : bpsForRank(activeCount + 1);

  const periodEarnedSol = stats ? stats.period.earnedLamports / 1e9 : 0;
  const periodEarnedUsd = stats?.solUsd ? periodEarnedSol * stats.solUsd : null;
  const vsPrevious =
    stats?.period.previousEarnedLamports !== null && stats?.period.previousEarnedLamports !== undefined
      ? stats.period.previousEarnedLamports > 0
        ? Math.round(((stats.period.earnedLamports - stats.period.previousEarnedLamports) / stats.period.previousEarnedLamports) * 100)
        : stats.period.earnedLamports > 0
          ? null // went from 0 to something — a % change from zero isn't a meaningful number to show
          : 0
      : undefined; // "all" period, or not computed — never shown

  function shareText() {
    const link = `${siteUrl()}/?ref=${address}`;
    return `${t("rec.shareText")} ${link}`;
  }

  return (
    <div>
      <InviterLine wallet={address} detailed className="mb-4 rounded-2xl border border-paper/10 bg-ink-raised px-4 py-3" />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("rec.title")}</h1>
          {stats?.founder ? (
            <p className="mt-1 text-sm font-semibold text-bamboo">{t("rec.founderBadge", { n: stats.founder.rank })}</p>
          ) : (
            state === "ready" && <p className="mt-1 text-sm font-semibold text-paper/80">{t("rec.currentTier", { pct: pct(currentTierBps) })}</p>
          )}
        </div>
        <Panda pose={state === "ready" ? "success" : "idle"} size={72} />
      </div>

      <section className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-xs text-panda-grey">{t("rec.yourLink")}</p>
        <CopyReferralLink wallet={address} className="mt-2" />
        <p className="mt-2 text-xs font-medium text-bamboo">{t("rec.halfPriceNote", { min: DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD })}</p>
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
            href={`https://t.me/share/url?url=${encodeURIComponent(`${siteUrl()}/?ref=${address}`)}&text=${encodeURIComponent(t("rec.shareText"))}`}
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
          {/* Filter bar: period, invitee status and a wallet search — all three persisted in the URL, and
              shared by the stats above, the invitee list and the payment history below. */}
          <section className="mt-6 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-panda-grey">
              {t("rec.filters.period")}
              <select
                value={period}
                onChange={(e) => setParams({ period: e.target.value })}
                className="rounded-xl border border-paper/10 bg-ink-raised px-3 py-2 text-xs text-paper outline-none focus:border-paper/30"
              >
                {(["all", "today", "yesterday", "7d", "30d", "month", "prevMonth"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`rec.period.${k}` as DictKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-panda-grey">
              {t("rec.filters.state")}
              <select
                value={stateFilter}
                onChange={(e) => setParams({ state: e.target.value })}
                className="rounded-xl border border-paper/10 bg-ink-raised px-3 py-2 text-xs text-paper outline-none focus:border-paper/30"
              >
                {INVITEE_FILTER_STATES.map((k) => (
                  <option key={k} value={k}>
                    {t(`rec.state.${k}` as DictKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-panda-grey">
              {t("rec.sort.label")}
              <select
                value={sort}
                onChange={(e) => setParams({ sort: e.target.value })}
                className="rounded-xl border border-paper/10 bg-ink-raised px-3 py-2 text-xs text-paper outline-none focus:border-paper/30"
              >
                {INVITEE_SORT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`rec.sort.${k}` as DictKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[11px] text-panda-grey">
              {t("rec.filters.search")}
              <input
                value={q}
                onChange={(e) => setParams({ q: e.target.value.trim() })}
                placeholder={t("rec.filters.searchPlaceholder")}
                className="rounded-xl border border-paper/10 bg-ink-raised px-3 py-2 text-xs text-paper outline-none placeholder:text-panda-grey focus:border-paper/30"
              />
            </label>
            {hasAny && (
              <button type="button" onClick={clear} className="rounded-xl px-3 py-2 text-xs font-semibold text-meme-orange hover:brightness-110">
                {t("rec.filters.clear")}
              </button>
            )}
          </section>

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
                <p className="text-xs text-panda-grey">{period === "all" ? t("rec.earnedTotal") : t("rec.earnedPeriod")}</p>
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
              {period === "all" ? (
                <>
                  <p className="mt-1.5 font-display text-xl font-bold leading-tight">{state === "loading" ? "…" : earnedUsd !== null ? money(earnedUsd) : `${earnedSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL`}</p>
                  {state === "ready" && <p className="mt-1 text-xs text-panda-grey">{earnedSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL</p>}
                </>
              ) : (
                <>
                  <p className="mt-1.5 font-display text-xl font-bold leading-tight">{state === "loading" ? "…" : periodEarnedUsd !== null ? money(periodEarnedUsd) : `${periodEarnedSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL`}</p>
                  {state === "ready" && (
                    <p className="mt-1 text-xs text-panda-grey">
                      {periodEarnedSol.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL
                      {vsPrevious !== undefined && vsPrevious !== null && <> · {t("rec.vsPrevious", { sign: vsPrevious >= 0 ? "+" : "", pct: vsPrevious })}</>}
                      {vsPrevious === null && <> · {t("rec.vsPreviousNew")}</>}
                    </p>
                  )}
                </>
              )}
            </div>
          </section>

          {state === "ready" && (
            <section className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-paper/[0.04] p-4">
                <p className="text-xs text-panda-grey">{t("rec.avgPerInvitee")}</p>
                <p className="mt-1.5 font-display text-base font-bold">{solAmount(avgEarnedLamports)} SOL</p>
              </div>
              <div className="rounded-2xl bg-paper/[0.04] p-4">
                <p className="text-xs text-panda-grey">{t("rec.bestDay")}</p>
                <p className="mt-1.5 font-display text-base font-bold">{stats?.period.bestDay ? `${solAmount(stats.period.bestDay.lamports)} SOL` : "—"}</p>
                {stats?.period.bestDay && <p className="mt-0.5 text-[11px] text-panda-grey">{stats.period.bestDay.day}</p>}
              </div>
              <div className="rounded-2xl bg-paper/[0.04] p-4">
                <p className="text-xs text-panda-grey">{t("rec.topInvitee")}</p>
                <p className="mt-1.5 font-display text-base font-bold">{stats?.period.topInvitee ? `${solAmount(stats.period.topInvitee.lamports)} SOL` : "—"}</p>
                {stats?.period.topInvitee && <p className="mt-0.5 truncate font-mono text-[11px] text-panda-grey">{short(stats.period.topInvitee.wallet)}</p>}
              </div>
            </section>
          )}
          <p className="mt-3 text-[11px] text-panda-grey">{t("rec.autoPayNote")}</p>

          {stats?.founder && (
            <section className="mt-4 rounded-2xl border border-bamboo/30 bg-bamboo/[0.06] p-4">
              <p className="text-sm font-semibold text-bamboo">{t("rec.founderBadge", { n: stats.founder.rank })} — {pct(FOUNDER_SHARE_BPS)}</p>
            </section>
          )}

          {state === "ready" && stats && !stats.founder && (
            <section className="mt-4 rounded-2xl bg-paper/[0.04] p-4">
              <p className="text-xs text-panda-grey">
                {t("rec.founderProgress", { n: stats.validInviteeCount, total: stats.founderRequiredTraders, min: stats.founderMinTraderVolumeUsd })}
              </p>
            </section>
          )}

          <section className="mt-6">
            <h2 className="font-display text-lg font-bold">
              {t("rec.inviteesTitle")}
              {state === "ready" && invitees && invitees.length > 0 && <span className="ml-2 rounded-full bg-paper/10 px-2 py-0.5 text-[11px] font-medium text-panda-grey">{filteredInvitees.length}</span>}
            </h2>
            {state === "loading" ? (
              <p className="mt-3 text-sm text-panda-grey">…</p>
            ) : !invitees || invitees.length === 0 ? (
              <p className="mt-3 text-sm text-panda-grey">{t("rec.inviteesEmpty")}</p>
            ) : filteredInvitees.length === 0 ? (
              <p className="mt-3 text-sm text-panda-grey">{t("rec.noMatches")}</p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-paper/10 overflow-hidden rounded-2xl border border-paper/10">
                  {visibleInvitees.map((inv) => (
                    <InviteeRow key={inv.wallet} inv={inv} founderMin={founderMin} isFounder={!!stats?.founder} t={t} lang={lang} />
                  ))}
                </ul>
                {visibleCount < filteredInvitees.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                    className="mt-3 w-full rounded-xl bg-paper/5 py-2.5 text-xs font-semibold text-paper/80 hover:bg-paper/10"
                  >
                    {t("rec.loadMore")} ({filteredInvitees.length - visibleCount})
                  </button>
                )}
              </>
            )}
          </section>

          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold">{t("rec.payoutsTitle")}</h2>
              <a href={csvHref} className="rounded-full bg-paper/10 px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-paper/15">
                {t("rec.downloadCsv")}
              </a>
            </div>
            {!payouts ? (
              <p className="mt-3 text-sm text-panda-grey">…</p>
            ) : payouts.length === 0 ? (
              <p className="mt-3 text-sm text-panda-grey">{t("rec.payoutsEmpty")}</p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-paper/10 overflow-hidden rounded-2xl border border-paper/10">
                  {payouts.map((p) => (
                    <li key={`${p.signature}-${p.ts}`} className="flex items-center justify-between gap-3 bg-ink-raised px-4 py-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-paper/90">{t("rec.payoutRow", { amount: solAmount(p.lamports), wallet: short(p.referred) })}</p>
                        <p className="mt-0.5 text-[11px] text-panda-grey">{new Date(p.ts).toLocaleString(lang, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${p.signature}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-semibold text-bamboo hover:underline"
                      >
                        Solscan
                      </a>
                    </li>
                  ))}
                </ul>
                {payoutsTotal > PAGE_SIZE && (
                  <div className="mt-3 flex items-center justify-center gap-3 text-xs">
                    <button type="button" disabled={payoutsPage <= 1} onClick={() => setPayoutsPage((p) => p - 1)} className="rounded-full bg-paper/5 px-3 py-1.5 font-semibold text-paper/80 hover:bg-paper/10 disabled:cursor-not-allowed disabled:opacity-40">
                      ←
                    </button>
                    <span className="text-panda-grey">
                      {payoutsPage} / {Math.ceil(payoutsTotal / PAGE_SIZE)}
                    </span>
                    <button
                      type="button"
                      disabled={payoutsPage >= Math.ceil(payoutsTotal / PAGE_SIZE)}
                      onClick={() => setPayoutsPage((p) => p + 1)}
                      className="rounded-full bg-paper/5 px-3 py-1.5 font-semibold text-paper/80 hover:bg-paper/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      →
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** One invitee's full row: address (with copy), state, how/when they joined, their discount status, last
 *  trade, what they've generated, and the two progress bars (trader-active streak, Founder-valid volume). */
function InviteeRow({
  inv,
  founderMin,
  isFounder,
  t,
  lang,
}: {
  inv: Invitee;
  founderMin: number;
  isFounder: boolean;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  lang: string;
}) {
  const [copied, setCopied] = useState(false);
  const streakFraction = inv.streakDays / 3;
  const volumeFraction = inv.tradedVolumeUsd / founderMin;
  const via = inv.source === "code" && inv.code ? t("rec.enteredCode", { code: inv.code }) : t("rec.enteredLink");
  const copy = () => {
    navigator.clipboard?.writeText(inv.wallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <li className="bg-ink-raised px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={copy} title={t("rec.copyAddress")} className="flex items-center gap-1.5 truncate font-mono text-xs text-paper/80 hover:text-paper">
            {short(inv.wallet)}
            <span aria-hidden className="text-panda-grey">{copied ? "✓" : "⧉"}</span>
          </button>
          <p className={`mt-0.5 text-[11px] font-semibold ${STATE_CLASS[inv.state]}`}>
            {inv.state === "bound" ? t("rec.stateBound") : inv.state === "pending" ? t("rec.statePending") : t("rec.stateRejected")}
          </p>
          <p className="mt-0.5 text-[11px] text-panda-grey">
            {via} · {t("rec.linkedOn", { date: new Date(inv.boundAt).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" }) })}
          </p>
          {inv.state === "bound" && (
            <p className="mt-0.5 text-[11px] text-panda-grey">{inv.lastTradeAt ? t("rec.lastTrade", { date: new Date(inv.lastTradeAt).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" }) }) : t("rec.lastTradeNever")}</p>
          )}
        </div>
        {inv.state === "bound" && (
          <div className="shrink-0 text-right">
            <p className="text-xs font-semibold text-paper/80">{(inv.earnedLamports / 1e9).toLocaleString(lang, { maximumFractionDigits: 4 })} SOL</p>
            <p className="mt-0.5 text-[11px] text-panda-grey">{t("rec.volumeLabel")}: {inv.tradedVolumeUsd.toLocaleString(lang, { maximumFractionDigits: 0 })} $</p>
            <p className={`mt-0.5 text-[11px] font-medium ${inv.discountActive ? "text-bamboo" : "text-panda-grey"}`}>{inv.discountActive ? t("rec.discountOn") : t("rec.discountOff")}</p>
          </div>
        )}
      </div>
      {inv.state === "pending" && <p className="mt-1.5 text-[11px] text-panda-grey">{t("rec.pendingRetry")}</p>}
      {inv.state === "bound" && (
        <>
          <ProgressBar label={t("rec.barActive")} value={t("rec.barActiveValue", { n: inv.streakDays })} fraction={streakFraction} />
          {!isFounder && (
            <ProgressBar
              label={t("rec.barFounder")}
              value={t("rec.barFounderValue", { amount: inv.tradedVolumeUsd.toLocaleString(lang, { maximumFractionDigits: 0 }), min: founderMin.toLocaleString(lang, { maximumFractionDigits: 0 }) })}
              fraction={volumeFraction}
            />
          )}
        </>
      )}
    </li>
  );
}
