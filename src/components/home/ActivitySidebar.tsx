"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import CoinAvatar from "@/components/CoinAvatar";
import CoinAge from "@/components/CoinAge";
import type { Position } from "@/lib/portfolio/positions";
import type { Launch } from "@/app/api/launches/route";
import { formatCompact, formatPct, formatUsd } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const PAGE_SIZE = 3;

type LoadState = "loading" | "ready" | "error";

/**
 * Right-hand column of the home page: the connected wallet's real positions
 * (from its logged PANDA trades) ranked best P&L first down to worst, plus the
 * newest real launches with the X profile each project published. Nothing
 * here is padded or invented — an empty wallet gets an honest empty state.
 */
export default function ActivitySidebar() {
  const { connected, publicKey } = useWallet();
  const { t } = useLanguage();
  const [state, setState] = useState<LoadState>("loading");
  const [positions, setPositions] = useState<Position[]>([]);
  const [page, setPage] = useState(0);
  const [launches, setLaunches] = useState<Launch[]>([]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setState("loading");
      })
      .then(() => fetch(`/api/portfolio/positions?wallet=${publicKey.toBase58()}`))
      .then((r) => r.json())
      .then((data: { open?: Position[]; closed?: Position[] }) => {
        if (cancelled) return;
        setPositions([...(data.open || []), ...(data.closed || [])]);
        setPage(0);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/launches")
      .then((r) => r.json())
      .then((data: { launches?: Launch[] }) => {
        if (!cancelled) setLaunches(data.launches || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const ranked = useMemo(() => [...positions].sort((a, b) => b.pnlUsd - a.pnlUsd), [positions]);
  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = ranked.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <aside className="space-y-10">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{t("side.topTrades")}</h2>
          {connected && state === "ready" && ranked.length > PAGE_SIZE && (
            <div className="flex items-center gap-2 text-xs text-panda-grey">
              <button
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                aria-label={t("side.prev")}
                className="rounded-full px-1.5 py-0.5 text-base leading-none hover:text-paper disabled:opacity-30"
              >
                ‹
              </button>
              <span>
                {currentPage + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
                disabled={currentPage >= totalPages - 1}
                aria-label={t("side.next")}
                className="rounded-full px-1.5 py-0.5 text-base leading-none hover:text-paper disabled:opacity-30"
              >
                ›
              </button>
            </div>
          )}
        </div>
        <p className="mt-1 text-xs text-panda-grey">{t("side.sortedNote")}</p>

        <div className="mt-4 space-y-3">
          {!connected ? (
            <p className="rounded-[22px] border border-paper/10 bg-ink-raised p-5 text-sm text-panda-grey">{t("side.connect")}</p>
          ) : state === "loading" ? (
            [0, 1].map((i) => <div key={i} className="h-44 animate-pulse rounded-[22px] bg-paper/5" />)
          ) : state === "error" ? (
            <p className="rounded-[22px] border border-paper/10 bg-ink-raised p-5 text-sm text-clay-red">{t("side.error")}</p>
          ) : ranked.length === 0 ? (
            <p className="rounded-[22px] border border-paper/10 bg-ink-raised p-5 text-sm text-panda-grey">{t("side.empty")}</p>
          ) : (
            visible.map((p) => <TradeCard key={p.mint} position={p} />)
          )}
        </div>
      </section>

      {launches.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-bold">{t("side.launches")}</h2>
          <p className="mt-1 text-xs text-panda-grey">{t("side.launchesNote")}</p>
          <div className="mt-4 divide-y divide-paper/10 rounded-[22px] border border-paper/10 bg-ink-raised">
            {launches.map((l) => (
              <LaunchRow key={l.mint} launch={l} />
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

function TradeCard({ position: p }: { position: Position }) {
  const { t } = useLanguage();
  const isOpen = p.remainingTokens > 0;
  const positive = p.pnlUsd >= 0;

  return (
    <Link
      href={`/coin/${p.mint}`}
      className="block overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised transition-colors hover:border-paper/25"
    >
      <div className="relative h-20 overflow-hidden" style={{ backgroundColor: p.coinBg || "#171512" }}>
        {p.coinImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.coinImage} alt="" className="h-full w-full scale-125 object-cover opacity-60 blur-[2px]" />
        )}
        <span className="absolute right-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 text-[11px] font-semibold text-paper/80 backdrop-blur">
          {isOpen ? t("side.open") : t("side.closed")}
        </span>
      </div>
      <div className="px-4 pb-4">
        <div className="-mt-7 h-14 w-14 overflow-hidden rounded-full border-4 border-ink-raised bg-ink">
          <CoinAvatar image={p.coinImage} ticker={p.ticker} />
        </div>
        <p className="mt-2 font-display text-lg font-bold">${p.ticker}</p>

        <div className="mt-3 flex items-end justify-between gap-3 text-sm">
          <div>
            <p className="font-semibold">
              {isOpen ? p.remainingTokens.toLocaleString(undefined, { maximumFractionDigits: 2 }) : t("side.fullyClosed")}
              {isOpen && <span className="ml-1 text-xs font-normal text-panda-grey">{t("side.held")}</span>}
            </p>
            {isOpen && (
              <p className="text-xs text-panda-grey">
                {t("side.avgCost")} {formatUsd(p.avgCostUsd)}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className={`font-semibold ${positive ? "text-bamboo" : "text-clay-red"}`}>
              {positive ? "+" : ""}
              {formatUsd(p.pnlUsd)}
            </p>
            <p className={`text-xs ${positive ? "text-bamboo" : "text-clay-red"}`}>{formatPct(p.pnlPct)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function LaunchRow({ launch: l }: { launch: Launch }) {
  const { t } = useLanguage();
  const handle = l.twitterUrl ? l.twitterUrl.split("?")[0].split("/").filter(Boolean).pop() : undefined;

  return (
    <div className="flex items-center gap-3 p-3.5">
      <Link href={`/coin/${l.mint}`} className="h-10 w-10 shrink-0 overflow-hidden rounded-full">
        <CoinAvatar image={l.image} ticker={l.ticker} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/coin/${l.mint}`} className="block truncate text-sm font-semibold hover:underline">
          ${l.ticker}
        </Link>
        {l.twitterUrl ? (
          <a href={l.twitterUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-meme-orange hover:brightness-110">
            @{handle} · X
          </a>
        ) : (
          <p className="truncate text-xs text-panda-grey">{t("side.noX")}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium">{formatCompact(l.marketCap)}</p>
        <CoinAge createdAt={l.createdAt} source={l.source} className="text-xs text-panda-grey" />
      </div>
    </div>
  );
}
