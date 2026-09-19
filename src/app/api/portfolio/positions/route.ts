import { NextResponse } from "next/server";
import { getTrades } from "@/lib/portfolio/trade-log";
import { computePositions } from "@/lib/portfolio/positions";
import { getLiveCoin } from "@/lib/live-coins";
import { fetchTokenPools } from "@/lib/gecko/client";

/** Real current USD price for an arbitrary mint — same fallback GeckoTerminal lookup used elsewhere
 *  (e.g. src/lib/solana/portfolio.ts) for a token that isn't necessarily in PANDA's top-volume list. */
async function realPriceUsd(mint: string): Promise<number | undefined> {
  const { data } = await fetchTokenPools(mint);
  const best = [...data].sort(
    (a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0)
  )[0];
  return best?.attributes.base_token_price_usd ? Number(best.attributes.base_token_price_usd) : undefined;
}

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "Missing wallet." }, { status: 400 });

  try {
    const trades = await getTrades(wallet);
    const mints = [...new Set(trades.map((t) => t.mint))];

    const [prices, metas] = await Promise.all([
      Promise.all(mints.map(async (m) => [m.toLowerCase(), await realPriceUsd(m)] as const)),
      Promise.all(
        mints.map(async (m) => {
          const { coin } = await getLiveCoin(m).catch(() => ({ coin: undefined }));
          return [m.toLowerCase(), coin ? { image: coin.image, doodle: coin.doodle, bg: coin.bg } : {}] as const;
        })
      ),
    ]);

    const { open, closed } = computePositions(trades, Object.fromEntries(prices), Object.fromEntries(metas));
    return NextResponse.json({ open, closed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute positions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
