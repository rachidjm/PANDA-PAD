import Link from "next/link";
import { Coin } from "@/lib/types";
import { formatCompact, formatPct } from "@/lib/format";
import Doodle from "@/components/doodles/Doodle";
import Sparkline from "@/components/Sparkline";

export default function CoinCard({ coin }: { coin: Coin }) {
  const positive = coin.changePct >= 0;

  return (
    <Link
      href={`/coin/${coin.mint}`}
      className="sticker-card group block overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised"
    >
      <div
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden p-8"
        style={{ backgroundColor: coin.image ? "#171512" : coin.bg }}
      >
        {coin.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coin.image} alt={coin.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Doodle kind={coin.doodle} className="h-full w-full" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-lg font-bold">${coin.ticker}</span>
          <span className={`text-sm font-semibold ${positive ? "text-bamboo" : "text-clay-red"}`}>
            {formatPct(coin.changePct)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-panda-grey">{coin.name}</p>

        <div className="mt-3 flex items-end justify-between gap-2">
          <dl className="space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="text-panda-grey">MC</dt>
              <dd className="font-medium">{formatCompact(coin.marketCap)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-panda-grey">Vol</dt>
              <dd className="font-medium">{formatCompact(coin.volume24h)}</dd>
            </div>
          </dl>
          <Sparkline data={coin.priceHistory} positive={positive} />
        </div>
      </div>
    </Link>
  );
}
