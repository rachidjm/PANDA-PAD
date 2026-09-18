import Link from "next/link";
import Panda from "@/components/panda/Panda";
import CoinCard from "@/components/CoinCard";
import LiveBadge from "@/components/LiveBadge";
import { getLiveCoins } from "@/lib/live-coins";

export default async function Home() {
  const { coins, live } = await getLiveCoins();
  const feed = [...coins].sort((a, b) => b.volume24h - a.volume24h);

  return (
    <div className="mx-auto max-w-6xl px-5">
      <section className="grid grid-cols-1 items-center gap-6 py-8 sm:gap-10 sm:py-16 md:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="font-display text-base font-semibold text-paper/70">PANDA</p>
          <h1 className="mt-3 font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            The GIF coin
            <br />
            launchpad
          </h1>
          <p className="mt-5 max-w-sm text-lg text-paper/70">
            Turn GIFs into coins. Create one in a minute, or trade what the internet already made.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/create"
              className="rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink hover:brightness-90 transition"
            >
              Create a coin
            </Link>
            <Link
              href="/discover"
              className="rounded-full border border-paper/20 px-6 py-3 text-sm font-semibold text-paper hover:border-paper/40 transition"
            >
              Explore coins
            </Link>
          </div>
        </div>

        <div className="flex justify-center md:justify-end">
          <Panda
            pose="idle"
            size={280}
            interactive
            className="h-[170px] w-[170px] drop-shadow-[0_20px_40px_rgba(0,0,0,0.35)] sm:h-[280px] sm:w-[280px]"
          />
        </div>
      </section>

      <section className="pb-24">
        <div className="mb-5 flex items-end justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-xl font-bold">Live coins</h2>
            <LiveBadge live={live} />
          </div>
          <Link href="/discover" className="text-sm font-medium text-paper/60 hover:text-paper transition-colors">
            View all
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {feed.slice(0, 8).map((coin) => (
            <CoinCard key={coin.mint} coin={coin} />
          ))}
        </div>
      </section>
    </div>
  );
}
