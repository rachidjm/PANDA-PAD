"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Panda from "@/components/panda/Panda";
import CoinAvatar from "@/components/CoinAvatar";
import { formatMoney, formatPct, formatRelativeTime, truncateAddress, type Currency } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useCurrency } from "./useCurrency";
import type { Position } from "@/lib/portfolio/positions";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import { combinedPnl, type Pnl, type Slice, type Summary, type TokenRow } from "@/lib/portfolio/view";
import { clipLabel, looksLikeSpam } from "@/lib/portfolio/spam";

export type LoadState = "loading" | "ready" | "error";
export type RewardsInfo = { earnedLamports: number; claimedLamports: number; claimableLamports: number; coins: number; partial: boolean };

export type PortfolioViewProps = {
  address: string;
  holdingsState: LoadState;
  /** The whole wallet's 24 h change (USD and %), or null when no holding has both a price and a 24 h figure. */
  change24h: { usd: number; pct: number; covered: number; of: number } | null;
  rows: TokenRow[];
  summary: Summary;
  alloc: Slice[];
  positionsState: LoadState;
  closed: Position[];
  recent: LoggedTrade[];
  historyError: boolean;
  rewards: RewardsInfo | "loading" | "error";
};

type SortMode = "value" | "recent" | "gain" | "loss";
const SORT_KEY = "panda:portfolio:sort";
const SLICE_COLORS = ["#ff6a1a", "#c9d94c", "#f7f4ec", "#e8543e", "#8b8680"];
const OTHER_COLOR = "rgba(247,244,236,0.25)";
const sliceColor = (s: Slice, i: number) => (s.other ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length]);

const num = (n: number, lang: string, maxFrac: number) => n.toLocaleString(lang, { maximumFractionDigits: maxFrac });
const sol = (lamports: number, lang: string) => num(lamports / 1e9, lang, 4);
const tone = (n: number) => (n >= 0 ? "text-bamboo" : "text-clay-red");

function readSort(): SortMode | null {
  try {
    const v = window.localStorage.getItem(SORT_KEY);
    return v === "value" || v === "recent" || v === "gain" || v === "loss" ? v : null;
  } catch {
    return null;
  }
}

function sortTokenRows(rows: TokenRow[], sort: SortMode): TokenRow[] {
  const arr = [...rows];
  if (sort === "value") return arr.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  if (sort === "recent") return arr.sort((a, b) => (b.lastTradeTs ?? 0) - (a.lastTradeTs ?? 0));
  const pnlOf = (r: TokenRow) => (r.pnl.kind === "unavailable" ? null : r.pnl.usd);
  return arr.sort((a, b) => {
    const [pa, pb] = [pnlOf(a), pnlOf(b)];
    if (pa === null) return pb === null ? 0 : 1;
    if (pb === null) return -1;
    return sort === "gain" ? pb - pa : pa - pb;
  });
}

function sortPositions(rows: Position[], sort: Exclude<SortMode, "value">): Position[] {
  const arr = [...rows];
  if (sort === "recent") return arr.sort((a, b) => b.lastTradeTs - a.lastTradeTs);
  return arr.sort((a, b) => (sort === "gain" ? b.pnlUsd - a.pnlUsd : a.pnlUsd - b.pnlUsd));
}

/** A real money amount in the selected display currency — a pulsing placeholder (never a spinner) while EUR's rate hasn't loaded yet. */
function Money({ usd, currency, eurUsd, signed, className, barW = "w-16" }: { usd: number; currency: Currency; eurUsd: number | null; signed?: boolean; className?: string; barW?: string }) {
  const { lang } = useLanguage();
  if (currency === "EUR" && eurUsd === null) return <span className={`inline-block h-[1em] ${barW} animate-pulse rounded bg-paper/10 align-middle`} aria-hidden />;
  const value = currency === "EUR" ? usd / (eurUsd as number) : usd;
  const text = signed ? `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value), currency, lang)}` : formatMoney(value, currency, lang);
  return <span className={className}>{text}</span>;
}

function CurrencyToggle({ currency, onChange }: { currency: Currency; onChange: (c: Currency) => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex shrink-0 gap-0.5 rounded-full bg-paper/[0.06] p-0.5" role="group" aria-label={t("pf.currencyAria")}>
      {(["EUR", "USD"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-pressed={currency === c}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${currency === c ? "bg-paper text-ink" : "text-panda-grey hover:text-paper"}`}
        >
          {c === "EUR" ? "€" : "$"}
        </button>
      ))}
    </div>
  );
}

function KindChip({ kind }: { kind: "tracked" | "estimated" }) {
  const { t } = useLanguage();
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        kind === "tracked" ? "bg-bamboo/15 text-bamboo" : "bg-meme-orange/15 text-meme-orange"
      }`}
    >
      {kind === "tracked" ? t("pf.kindTracked") : t("pf.kindEstimated")}
    </span>
  );
}

function Stat({ label, chip, children, foot }: { label: string; chip?: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-paper/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-panda-grey">{label}</p>
        {chip}
      </div>
      <div className="mt-1.5 font-display text-xl font-bold leading-tight">{children}</div>
      {foot && <p className="mt-1 text-xs text-panda-grey">{foot}</p>}
    </div>
  );
}

/** A position's gain/loss %, compactly — never its own separate P&L card, just the row's second line. */
function PnlPct({ pnl }: { pnl: Pnl }) {
  const { t } = useLanguage();
  if (pnl.kind === "unavailable") {
    if (pnl.reason === "not_tracked") return null;
    return (
      <span className="text-panda-grey" title={pnl.reason === "no_trades" ? t("pf.unavailNoTrades") : t("pf.unavailNoPrice")}>
        {t("pf.unavailable")}
      </span>
    );
  }
  return (
    <span className={tone(pnl.pct)}>
      {pnl.kind === "estimated" && <span title={t("pf.kindEstimated")}>≈ </span>}
      {formatPct(pnl.pct)}
    </span>
  );
}

/** The long "Tracked = ... Estimated = ... Unavailable = ..." explanation, collapsed behind a small (i) — tapped open, not always on screen. */
function LegendInfo() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("pf.legendAria")}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-paper/20 text-[11px] font-semibold text-panda-grey transition-colors hover:border-paper/40 hover:text-paper"
      >
        i
      </button>
      {open && <p className="mt-2 text-[11px] leading-relaxed text-panda-grey">{t("pf.legend")}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-1.5 p-4">
      {[0, 1].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-paper/5" />
      ))}
    </div>
  );
}

export default function PortfolioView(p: PortfolioViewProps) {
  const { t, lang } = useLanguage();
  const { holderRewards } = useFeatures();
  const { currency, setCurrency, eurUsd } = useCurrency(lang);
  const [tab, setTab] = useState<"holdings" | "closed" | "activity">("holdings");
  const [sort, setSort] = useState<SortMode>("value");
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    // A macrotask, not a microtask — see useCurrency.ts for why a `Promise.then()` here can race React's
    // concurrent hydration on a tree this size and cause a real server/client mismatch.
    const timer = setTimeout(() => {
      const stored = readSort();
      if (stored) setSort(stored);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_KEY, sort);
    } catch {
      // Not remembered this time — sorting still works for the rest of the visit.
    }
  }, [sort]);

  // Ads airdropped to the wallet are listed apart (like a wallet app does), one click away.
  const spam = useMemo(() => p.rows.filter((r) => looksLikeSpam(r) && r.valueUsd === undefined), [p.rows]);
  const visibleRows = useMemo(() => p.rows.filter((r) => !spam.includes(r)), [p.rows, spam]);
  const sortedRows = useMemo(() => sortTokenRows(showHidden ? p.rows : visibleRows, sort), [p.rows, visibleRows, showHidden, sort]);
  const sortedClosed = useMemo(() => sortPositions(p.closed, sort === "value" ? "recent" : sort), [p.closed, sort]);
  // Real coin images, for the coins this wallet has ever held (open, closed, or in its activity log alike).
  const imageByMint = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const r of p.rows) if (r.image) m.set(r.mint, r.image);
    for (const c of p.closed) if (c.coinImage) m.set(c.mint, c.coinImage);
    return m;
  }, [p.rows, p.closed]);

  const s = p.summary;
  const combined = combinedPnl(s);
  const anyEstimatedClosed = p.closed.some((c) => c.estimated || c.partialHistory);
  const trulyEmpty = p.holdingsState === "ready" && p.rows.length === 0;
  const chipBtn = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-paper/10 text-paper" : "text-panda-grey hover:text-paper"}`;
  const money = (usd: number, opts?: { signed?: boolean; barW?: string }) => <Money usd={usd} currency={currency} eurUsd={eurUsd} {...opts} />;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{t("pf.title")}</h1>
          <p className="mt-1 text-sm text-panda-grey">{t("pf.subtitle", { addr: truncateAddress(p.address) })}</p>
        </div>
        <Panda pose={p.holdingsState === "ready" ? "success" : "idle"} size={72} />
      </div>

      {/* ---- summary ---- */}
      <section className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-panda-grey">{t("pf.totalValue")}</p>
          <CurrencyToggle currency={currency} onChange={setCurrency} />
        </div>
        <p className="mt-1 font-display text-3xl font-bold">
          {p.holdingsState === "loading" ? (
            <span className="inline-block h-[1em] w-32 animate-pulse rounded bg-paper/10 align-middle" aria-hidden />
          ) : s.valueUsd !== null ? (
            money(s.valueUsd, { barW: "w-32" })
          ) : (
            "—"
          )}
        </p>
        {p.holdingsState === "ready" && p.change24h && (
          <p className={`mt-1 text-sm font-medium ${p.change24h.usd >= 0 ? "text-bamboo" : "text-clay-red"}`} title={t("pf.change24hCovers", { n: p.change24h.covered, m: p.change24h.of })}>
            {money(p.change24h.usd, { signed: true })} · {formatPct(p.change24h.pct)} <span className="font-normal text-panda-grey">{t("pf.change24h")}</span>
          </p>
        )}
        {p.holdingsState === "loading" && <p className="mt-2 text-xs text-panda-grey">{t("pf.reading")}</p>}
        {p.holdingsState === "error" && <p className="mt-2 text-xs text-clay-red">{t("pf.readError")}</p>}
        {p.holdingsState === "ready" && s.valueUsd === null && <p className="mt-2 text-xs text-panda-grey">{t("pf.noPriced")}</p>}
        {p.holdingsState === "ready" && s.valueUsd !== null && s.unpricedCount > 0 && (
          <p className="mt-2 text-xs text-panda-grey">{t("pf.pricedOnly", { n: s.unpricedCount })}</p>
        )}

        <div className={`mt-5 grid gap-3 ${holderRewards ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          <Stat label={t("pf.pnlTotal")} chip={combined ? <KindChip kind={combined.kind} /> : undefined}>
            {combined ? (
              money(combined.usd, { signed: true, barW: "w-20" })
            ) : (
              <span className="text-sm font-medium text-panda-grey">{p.holdingsState === "loading" || p.positionsState === "loading" ? "…" : t("pf.pnlNone")}</span>
            )}
          </Stat>

          {holderRewards && (
            <Stat
              label={t("pf.rewards")}
              foot={
                p.rewards !== "loading" && p.rewards !== "error" && p.rewards.earnedLamports > 0 ? (
                  <>
                    {t("pf.rewardsReady")}
                    <br />
                    {t("pf.rewardsEarned", { earned: sol(p.rewards.earnedLamports, lang), claimed: sol(p.rewards.claimedLamports, lang) })}
                  </>
                ) : undefined
              }
            >
              {p.rewards === "loading" ? (
                <span className="text-sm font-medium text-panda-grey">…</span>
              ) : p.rewards === "error" ? (
                <span className="text-sm font-medium text-panda-grey">{t("pf.rewardsError")}</span>
              ) : p.rewards.earnedLamports === 0 ? (
                <span className="text-sm font-medium text-panda-grey">{t("pf.rewardsNone")}</span>
              ) : (
                <span>
                  {sol(p.rewards.claimableLamports, lang)} <span className="text-sm font-medium text-panda-grey">SOL</span>
                </span>
              )}
            </Stat>
          )}
        </div>

        {combined && (combined.unrealizedUsd !== null || combined.realizedUsd !== null) && (
          <p className="mt-2 text-[11px] text-panda-grey" title={s.unrealized ? t("pf.pnlCovers", { n: s.unrealized.coveredCount, m: s.unrealized.coveredCount + s.unrealized.excludedCount }) : undefined}>
            {combined.unrealizedUsd !== null && (
              <>
                {t("pf.pnlOpen")} {money(combined.unrealizedUsd, { signed: true, barW: "w-10" })}
              </>
            )}
            {combined.unrealizedUsd !== null && combined.realizedUsd !== null && " · "}
            {combined.realizedUsd !== null && (
              <>
                {t("pf.pnlRealized")} {money(combined.realizedUsd, { signed: true, barW: "w-10" })}
              </>
            )}
          </p>
        )}

        {holderRewards && p.rewards !== "loading" && p.rewards !== "error" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-panda-grey">{p.rewards.partial ? t("pf.rewardsPartial") : ""}</span>
            <Link href="/rewards" className="font-medium text-meme-orange hover:underline">
              {t("pf.rewardsOpen")} →
            </Link>
          </div>
        )}
        <LegendInfo />
      </section>

      {/* ---- allocation ---- */}
      {p.alloc.length > 0 && (
        <section className="mt-4 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
          <p className="text-xs text-panda-grey">{t("pf.allocation")}</p>
          <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={p.alloc.map((a) => `${a.label} ${(a.bps / 100).toFixed(1)}%`).join(", ")}>
            {p.alloc.map((a, i) => (
              <div key={a.key} style={{ width: `${a.bps / 100}%`, backgroundColor: sliceColor(a, i) }} className="h-full min-w-[3px]" />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {p.alloc.map((a, i) => (
              <li key={a.key} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: sliceColor(a, i) }} />
                <span className="truncate">{a.other ? t("pf.other") : a.label}</span>
                <span className="ml-auto text-panda-grey">{(a.bps / 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- holdings / closed / activity ---- */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5 rounded-full bg-ink-raised p-1">
            {(["holdings", "closed", "activity"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === k ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
              >
                {k === "holdings" ? t("pf.tabHoldings") : k === "closed" ? t("pf.tabClosed") : t("pf.activity")}
              </button>
            ))}
          </div>
          {tab !== "activity" && (
            <div className="flex flex-wrap gap-1">
              {(tab === "holdings" ? (["value", "recent", "gain", "loss"] as const) : (["recent", "gain", "loss"] as const)).map((m) => (
                <button key={m} onClick={() => setSort(m)} className={chipBtn(sort === m || (tab === "closed" && sort === "value" && m === "recent"))}>
                  {m === "value" ? t("pf.sortValue") : m === "recent" ? t("pf.sortRecent") : m === "gain" ? t("pf.sortGain") : t("pf.sortLoss")}
                </button>
              ))}
            </div>
          )}
        </div>

        {p.historyError && <p className="mt-3 text-xs text-panda-grey">{t("pf.historyError")}</p>}
        {[...p.rows, ...p.closed].length > 0 && p.positionsState === "ready" && (anyEstimatedClosed || p.rows.some((r) => r.pnl.kind === "estimated")) && (
          <p className="mt-3 text-xs text-panda-grey">{t("pf.estimatedNote")}</p>
        )}

        <div className="mt-4 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
          {tab === "holdings" && p.holdingsState === "loading" && <Skeleton />}
          {tab === "holdings" && p.holdingsState === "error" && <p className="p-6 text-center text-sm text-clay-red">{t("pf.readError")}</p>}
          {tab === "holdings" && p.holdingsState === "ready" && sortedRows.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm text-panda-grey">{trulyEmpty ? t("pf.emptyHoldings") : t("pf.allHidden")}</p>
              {trulyEmpty && (
                <Link href="/" className="mt-3 inline-block rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink hover:brightness-90 transition">
                  {t("pf.discoverCoins")}
                </Link>
              )}
            </div>
          )}
          {tab === "holdings" &&
            p.holdingsState === "ready" &&
            sortedRows.map((r) => (
              <Link key={r.mint} href={`/coin/${r.mint}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-paper/[0.03]">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={r.image} ticker={r.symbol || ""} mint={r.mint} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.symbol ? `$${clipLabel(r.symbol)}` : truncateAddress(r.mint)}
                    {r.name && <span className="ml-2 hidden text-xs font-normal text-panda-grey sm:inline">{clipLabel(r.name, 24)}</span>}
                  </p>
                  <p className="text-xs text-panda-grey">
                    {num(r.amount, lang, r.amount >= 1000 ? 0 : 4)}
                    {!(r.pnl.kind === "unavailable" && r.pnl.reason === "not_tracked") && (
                      <>
                        {" "}
                        · <PnlPct pnl={r.pnl} />
                      </>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">{r.valueUsd !== undefined ? money(r.valueUsd) : <span className="text-sm text-panda-grey">{t("pf.noPrice")}</span>}</p>
                </div>
              </Link>
            ))}

          {tab === "holdings" && p.holdingsState === "ready" && spam.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 p-4 text-xs text-panda-grey">
              {t("pf.hidden", { n: spam.length })}
              <button type="button" onClick={() => setShowHidden((v) => !v)} className="font-semibold text-meme-orange hover:brightness-110">
                {showHidden ? t("pf.hideHidden") : t("pf.showHidden")}
              </button>
            </p>
          )}

          {tab === "closed" && p.positionsState === "loading" && <Skeleton />}
          {tab === "closed" && p.positionsState === "error" && <p className="p-6 text-center text-sm text-clay-red">{t("pf.tradesError")}</p>}
          {tab === "closed" && p.positionsState === "ready" && sortedClosed.length === 0 && <p className="p-6 text-center text-sm text-panda-grey">{t("pf.emptyClosed")}</p>}
          {tab === "closed" &&
            p.positionsState === "ready" &&
            sortedClosed.map((c) => (
              <Link key={c.mint} href={`/coin/${c.mint}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-paper/[0.03]">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={c.coinImage} ticker={c.ticker} mint={c.mint} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    ${clipLabel(c.ticker)}
                    {c.coinName && <span className="ml-2 hidden text-xs font-normal text-panda-grey sm:inline">{clipLabel(c.coinName, 24)}</span>}
                  </p>
                  <p className="text-xs text-panda-grey">{t("pf.fullyClosed")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-medium ${tone(c.pnlUsd)}`}>{money(c.pnlUsd, { signed: true })}</p>
                  <p className={`text-xs ${tone(c.pnlUsd)}`}>
                    {(c.estimated || c.partialHistory) && "≈ "}
                    {formatPct(c.pnlPct)}
                  </p>
                </div>
              </Link>
            ))}

          {tab === "activity" && p.positionsState === "loading" && <Skeleton />}
          {tab === "activity" && p.positionsState === "ready" && p.recent.length === 0 && <p className="p-6 text-center text-sm text-panda-grey">{t("pf.activityEmpty")}</p>}
          {tab === "activity" &&
            p.positionsState === "ready" &&
            p.recent.map((tr) => (
              <div key={tr.signature} className="flex items-center gap-3 p-4">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={imageByMint.get(tr.mint)} ticker={tr.ticker} mint={tr.mint} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tr.side === "buy" ? "bg-bamboo/15 text-bamboo" : "bg-clay-red/15 text-clay-red"}`}>
                      {tr.side === "buy" ? t("pf.bought") : t("pf.sold")}
                    </span>
                    <Link href={`/coin/${tr.mint}`} className="truncate font-medium hover:underline">
                      ${clipLabel(tr.ticker)}
                    </Link>
                  </div>
                  <p className="mt-0.5 text-xs text-panda-grey" title={tr.estimated ? t("pf.fromChain") : undefined}>
                    {tr.estimated ? "≈ " : ""}
                    {num(tr.tokenAmount, lang, tr.tokenAmount >= 1000 ? 0 : 4)} ${clipLabel(tr.ticker)}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="text-sm font-medium text-paper">{money(tr.solAmount * tr.solPriceUsdAtTrade)}</p>
                  <p className="text-panda-grey">{formatRelativeTime(tr.ts, lang)}</p>
                  <a href={`https://solscan.io/tx/${tr.signature}`} target="_blank" rel="noopener noreferrer" className="font-medium text-meme-orange hover:underline">
                    {t("pf.viewTx")} ↗
                  </a>
                </div>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
