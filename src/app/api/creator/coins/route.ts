import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { getLiveCoins } from "@/lib/live-coins";
import { pendingCreatorFeesForMint } from "@/lib/pump/distribute";
import { getHolderCount } from "@/lib/pump/holders-count";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { solPriceUsd } from "@/lib/solana/prices";
import { eurUsdRate } from "@/lib/strategy/market";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** How many of the wallet's coins get a live on-chain fee/holders read per request — keeps this inside the serverless time limit. */
const MAX_DETAILED = 25;

export type CreatorCoin = {
  mint: string;
  ticker: string;
  name: string;
  image?: string;
  price: number | null;
  marketCap: number;
  volume24h: number;
  holders: number | null;
  /** Real creator-fee lamports ready to collect right now, or null when the coin never opted into Fee Distribution. */
  pendingFeeLamports: number | null;
};

/**
 * Public, read-only: every coin PANDA's own live list has with this wallet as its creator (see live-coins.ts —
 * already cached/shared, so this doesn't add a new expensive fetch), each with a real, current read of its
 * pending creator fees (src/lib/pump/distribute.ts, the same on-chain SharingConfig this app's launches
 * write) and its real holder count (Helius, src/lib/pump/holders-count.ts — null when it can't be read, never
 * a fabricated number).
 */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`creator-coins:ip:${clientIp(req)}`, 20, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const { coins } = await getLiveCoins();
    const mine = coins.filter((c) => c.creator === wallet);
    const detailed = mine.slice(0, MAX_DETAILED);

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const [details, solUsd, eurUsd] = await Promise.all([
      Promise.all(
        detailed.map(async (c) => {
          const [pendingFeeLamports, holders] = await Promise.all([
            pendingCreatorFeesForMint(connection, c.mint, PANDA_TREASURY).catch(() => null),
            getHolderCount(c.mint),
          ]);
          return { pendingFeeLamports, holders };
        })
      ),
      solPriceUsd().catch(() => 0),
      eurUsdRate(),
    ]);

    const items: CreatorCoin[] = detailed.map((c, i) => ({
      mint: c.mint,
      ticker: c.ticker,
      name: c.name,
      image: c.image,
      price: c.priceHistory.length ? c.priceHistory[c.priceHistory.length - 1] : null,
      marketCap: c.marketCap,
      volume24h: c.volume24h,
      holders: details[i].holders,
      pendingFeeLamports: details[i].pendingFeeLamports,
    }));

    return NextResponse.json(
      { coins: items, truncated: mine.length > detailed.length, solUsd: solUsd > 0 ? solUsd : null, eurUsd },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read your coins.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

