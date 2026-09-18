import Link from "next/link";
import Panda from "@/components/panda/Panda";
import HomeFeed from "@/components/HomeFeed";
import { getLiveCoins } from "@/lib/live-coins";

export default async function Home() {
  const { coins, live } = await getLiveCoins();

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

      <HomeFeed coins={coins} live={live} />
    </div>
  );
}
