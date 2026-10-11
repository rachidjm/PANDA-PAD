"use client";

import { usePathname } from "next/navigation";
import CoinAvatar from "@/components/CoinAvatar";
import { knownCoin } from "./cache";
import { Change, money, priceLabel } from "./bits";

/**
 * What is on screen in the instant before a screen's data is: its shape, in soft blocks — and, for a coin, what a list
 * already showed of it (its picture, name and price).
 */

const block = "animate-pulse rounded-lg bg-paper/10";

export function RowsSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <ul className="mt-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 border-b border-paper/10 py-2.5 last:border-b-0">
          <span className={`${block} h-10 w-10 shrink-0 rounded-xl`} />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className={`${block} block h-3.5 w-24`} />
            <span className={`${block} block h-3 w-32`} />
          </span>
          <span className="shrink-0 space-y-1.5">
            <span className={`${block} ml-auto block h-3.5 w-16`} />
            <span className={`${block} block h-3 w-24`} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScreenSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <div className={`${block} h-11 w-full rounded-2xl`} />
      <RowsSkeleton />
    </div>
  );
}

export function CoinSkeleton() {
  const mint = /^\/tg\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(usePathname() ?? "")?.[1] ?? null;
  const known = mint ? knownCoin(mint) : null;
  return (
    <div role="status" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-paper/10 bg-[#171512]">{known && mint ? <CoinAvatar image={known.image ?? undefined} ticker={known.ticker ?? "?"} mint={mint} priority /> : null}</div>
        <div className="min-w-0 flex-1">
          {known?.ticker ? <h1 className="truncate font-display text-xl font-bold">${known.ticker}</h1> : <div className={`${block} h-6 w-28`} />}
          {known?.name ? <p className="truncate text-xs text-panda-grey">{known.name}</p> : <div className={`${block} mt-1.5 h-3 w-36`} />}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3">
        {known ? (
          <>
            <Stat value={priceLabel(known.priceUsd)} />
            <Stat value={money(known.marketCap)} />
            <Stat value={<Change pct={known.change24h} />} />
          </>
        ) : null}
        {Array.from({ length: known ? 3 : 6 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <div className={`${block} h-3 w-12`} />
            <div className={`${block} h-4 w-16`} />
          </div>
        ))}
      </div>
      <ChartSkeleton />
      <div className={`${block} mt-4 h-40 w-full rounded-2xl`} />
    </div>
  );
}

function Stat({ value }: { value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={`${block} h-3 w-12`} />
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ChartSkeleton() {
  return <div className={`${block} mt-4 h-[26rem] w-full rounded-2xl`} aria-hidden />;
}
