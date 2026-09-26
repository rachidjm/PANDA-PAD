"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Panda from "@/components/panda/Panda";
import CoinAvatar from "@/components/CoinAvatar";
import { formatPct, formatPrice, formatRelativeTime, formatUsd, truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import type { Position } from "@/lib/portfolio/positions";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import type { Pnl, Slice, Summary, TokenRow } from "@/lib/portfolio/view";

export type LoadState = "loading" | "ready" | "error";
export type RewardsInfo = { earnedLamports: number; claimedLamports: number; claimableLamports: number; coins: number; partial: boolean };

export type PortfolioViewProps = {
  address: string;
  holdingsState: LoadState;
  rows: TokenRow[];
  summary: Summary;
  alloc: Slice[];
  positionsState: LoadState;
  closed: Position[];
  recent: LoggedTrade[];
  historyError: boolean;
  rewards: RewardsInfo | "loading" | "error";
};

type SortMode = "value" | "recent" | "profit";
const SLICE_COLORS = ["#ff6a1a", "#c9d94c", "#f7f4ec", "#e8543e", "#8b8680"];
const OTHER_COLOR = "rgba(247,244,236,0.25)";
const sliceColor = (s: Slice, i: number) => (s.other ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length]);

const num = (n: number, lang: string, maxFrac: number) => n.toLocaleString(lang, { maximumFractionDigits: maxFrac });
const sol = (lamports: number, lang: string) => num(lamports / 1e9, lang, 4);
const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${formatUsd(Math.abs(n))}`;
const tone = (n: number) => (n >= 0 ? "text-bamboo" : "text-clay-red");

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

function PnlCell({ pnl }: { pnl: Pnl }) {
  const { t } = useLanguage();
  if (pnl.kind === "unavailable") {
    if (pnl.reason === "not_tracked") return null;
    return (
      <p className="text-xs text-panda-grey" title={pnl.reason === "no_trades" ? t("pf.unavailNoTrades") : t("pf.unavailNoPrice")}>
        {t("pf.unavailable")}
      </p>
    );
  }
  return (
    <p className={`text-xs ${tone(pnl.usd)}`}>
      {pnl.kind === "estimated" && <span title={t("pf.kindEstimated")}>≈ </span>}
      {signedUsd(pnl.usd)} · {formatPct(pnl.pct)}
    </p>
  );
}

export default function PortfolioView(p: PortfolioViewProps) {
  const { t, lang } = useLanguage();
  const { holderRewards } = useFeatures();
  const [tab, setTab] = useState<"holdings" | "closed">("holdings");
  const [sort, setSort] = useState<SortMode>("value");

  const sortedRows = useMemo(() => {
    const pnlOf = (r: TokenRow) => (r.pnl.kind === "unavailable" ? -Infinity : r.pnl.usd);
    return [...p.rows].sort((a, b) =>
      sort === "profit" ? pnlOf(b) - pnlOf(a) : sort === "recent" ? (b.lastTradeTs ?? 0) - (a.lastTradeTs ?? 0) : (b.valueUsd ?? -1) - (a.valueUsd ?? -1)
    );
  }, [p.rows, sort]);
  const sortedClosed = useMemo(
    () => [...p.closed].sort((a, b) => (sort === "profit" ? b.pnlUsd - a.pnlUsd : b.lastTradeTs - a.lastTradeTs)),
    [p.closed, sort]
  );

  const s = p.summary;
  const anyEstimatedClosed = p.closed.some((c) => c.estimated || c.partialHistory);
  const chipBtn = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-paper/10 text-paper" : "text-panda-grey hover:text-paper"}`;

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
        <p className="text-xs text-panda-grey">{t("pf.totalValue")}</p>
        <p className="mt-1 font-display text-3xl font-bold">{p.holdingsState === "loading" ? "…" : s.valueUsd !== null ? formatUsd(s.valueUsd) : "—"}</p>
        {p.holdingsState === "loading" && <p className="mt-2 text-xs text-panda-grey">{t("pf.reading")}</p>}
        {p.holdingsState === "error" && <p className="mt-2 text-xs text-clay-red">{t("pf.readError")}</p>}
        {p.holdingsState === "ready" && s.valueUsd === null && <p className="mt-2 text-xs text-panda-grey">{t("pf.noPriced")}</p>}
        {p.holdingsState === "ready" && s.valueUsd !== null && s.unpricedCount > 0 && (
          <p className="mt-2 text-xs text-panda-grey">{t("pf.pricedOnly", { n: s.unpricedCount })}</p>
        )}

        <div className={`mt-5 grid gap-3 ${holderRewards ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <Stat
            label={t("pf.pnlOpen")}
            chip={s.unrealized ? <KindChip kind={s.unrealized.kind} /> : undefined}
            foot={s.unrealized ? t("pf.pnlCovers", { n: s.unrealized.coveredCount, m: s.unrealized.coveredCount + s.unrealized.excludedCount }) : undefined}
          >
            {s.unrealized ? (
              <span className={tone(s.unrealized.usd)}>
                {signedUsd(s.unrealized.usd)}
                {s.unrealized.pct !== null && <span className="ml-1.5 text-sm font-medium">{formatPct(s.unrealized.pct)}</span>}
              </span>
            ) : (
              <span className="text-sm font-medium text-panda-grey">{p.holdingsState === "loading" || p.positionsState === "loading" ? "…" : t("pf.unavailable")}</span>
            )}
          </Stat>

          <Stat label={t("pf.pnlRealized")} chip={s.realized ? <KindChip kind={s.realized.kind} /> : undefined}>
            {s.realized ? (
              <span className={tone(s.realized.usd)}>{signedUsd(s.realized.usd)}</span>
            ) : (
              <span className="text-sm font-medium text-panda-grey">{p.positionsState === "loading" ? "…" : t("pf.pnlNone")}</span>
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

        {holderRewards && p.rewards !== "loading" && p.rewards !== "error" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-panda-grey">{p.rewards.partial ? t("pf.rewardsPartial") : ""}</span>
            <Link href="/rewards" className="font-medium text-meme-orange hover:underline">
              {t("pf.rewardsOpen")} →
            </Link>
          </div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-panda-grey">{t("pf.legend")}</p>
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

      {/* ---- holdings / closed ---- */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5 rounded-full bg-ink-raised p-1">
            {(["holdings", "closed"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === k ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
              >
                {k === "holdings" ? t("pf.tabHoldings") : t("pf.tabClosed")}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(tab === "holdings" ? (["value", "recent", "profit"] as const) : (["recent", "profit"] as const)).map((m) => (
              <button key={m} onClick={() => setSort(m)} className={chipBtn(sort === m || (tab === "closed" && sort === "value" && m === "recent"))}>
                {m === "value" ? t("pf.sortValue") : m === "recent" ? t("pf.sortRecent") : t("pf.sortProfit")}
              </button>
            ))}
          </div>
        </div>

        {p.historyError && <p className="mt-3 text-xs text-panda-grey">{t("pf.historyError")}</p>}
        {[...p.rows, ...p.closed].length > 0 && p.positionsState === "ready" && (anyEstimatedClosed || p.rows.some((r) => r.pnl.kind === "estimated")) && (
          <p className="mt-3 text-xs text-panda-grey">{t("pf.estimatedNote")}</p>
        )}

        <div className="mt-4 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
          {tab === "holdings" && p.holdingsState === "loading" && <Skeleton />}
          {tab === "holdings" && p.holdingsState === "error" && <p className="p-6 text-center text-sm text-clay-red">{t("pf.readError")}</p>}
          {tab === "holdings" && p.holdingsState === "ready" && sortedRows.length === 0 && <p className="p-6 text-center text-sm text-panda-grey">{t("pf.noBalances")}</p>}
          {tab === "holdings" &&
            p.holdingsState === "ready" &&
            sortedRows.map((r) => (
              <div key={r.mint} className="flex items-center gap-3 p-4">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={r.image} ticker={r.symbol || "?"} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.symbol ? `$${r.symbol}` : truncateAddress(r.mint)}
                    {r.name && <span className="ml-2 hidden text-xs font-normal text-panda-grey sm:inline">{r.name}</span>}
                  </p>
                  <p className="text-xs text-panda-grey">
                    {num(r.amount, lang, r.amount >= 1000 ? 0 : 4)}
                    {r.avgEntryUsd !== null && <> · {t("pf.avgEntry", { avg: formatPrice(r.avgEntryUsd) })}</>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">{r.valueUsd !== undefined ? formatUsd(r.valueUsd) : <span className="text-sm text-panda-grey">{t("pf.noPrice")}</span>}</p>
                  <PnlCell pnl={r.pnl} />
                </div>
              </div>
            ))}

          {tab === "closed" && p.positionsState === "loading" && <Skeleton />}
          {tab === "closed" && p.positionsState === "error" && <p className="p-6 text-center text-sm text-clay-red">{t("pf.tradesError")}</p>}
          {tab === "closed" && p.positionsState === "ready" && sortedClosed.length === 0 && <p className="p-6 text-center text-sm text-panda-grey">{t("pf.emptyClosed")}</p>}
          {tab === "closed" &&
            p.positionsState === "ready" &&
            sortedClosed.map((c) => (
              <div key={c.mint} className="flex items-center gap-3 p-4">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={c.coinImage} ticker={c.ticker} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">${c.ticker}</p>
                  <p className="text-xs text-panda-grey">{t("pf.fullyClosed")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-medium ${tone(c.pnlUsd)}`}>
                    {c.estimated || c.partialHistory ? "≈ " : ""}
                    {signedUsd(c.pnlUsd)}
                  </p>
                  <p className={`text-xs ${tone(c.pnlUsd)}`}>{formatPct(c.pnlPct)}</p>
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* ---- recent activity ---- */}
      <section className="mt-8">
        <h2 className="font-display text-lg font-bold">{t("pf.activity")}</h2>
        <div className="mt-3 divide-y divide-paper/10 rounded-[24px] border border-paper/10 bg-ink-raised">
          {p.positionsState === "loading" && <Skeleton />}
          {p.positionsState === "ready" && p.recent.length === 0 && <p className="p-6 text-center text-sm text-panda-grey">{t("pf.activityEmpty")}</p>}
          {p.positionsState === "ready" &&
            p.recent.map((tr) => (
              <div key={tr.signature} className="flex items-center gap-3 p-4">
                <span
                  className={`w-16 shrink-0 rounded-full py-1 text-center text-[11px] font-medium ${
                    tr.side === "buy" ? "bg-bamboo/15 text-bamboo" : "bg-clay-red/15 text-clay-red"
                  }`}
                >
                  {tr.side === "buy" ? t("pf.bought") : t("pf.sold")}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/coin/${tr.mint}`} className="truncate font-medium hover:underline">
                    ${tr.ticker}
                  </Link>
                  <p className="text-xs text-panda-grey" title={tr.estimated ? t("pf.fromChain") : undefined}>
                    {tr.estimated ? "≈ " : ""}
                    {num(tr.tokenAmount, lang, tr.tokenAmount >= 1000 ? 0 : 4)} · {num(tr.solAmount, lang, 4)} SOL
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-panda-grey">
                  <p>{formatRelativeTime(tr.ts, lang)}</p>
                  <a href={`https://solscan.io/tx/${tr.signature}`} target="_blank" rel="noopener noreferrer" className="text-meme-orange hover:underline">
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

function Skeleton() {
  return (
    <div className="space-y-1.5 p-4">
      {[0, 1].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-paper/5" />
      ))}
    </div>
  );
}
