import { NextResponse } from "next/server";
import { appDeps, appGate, noStore } from "@/lib/telegram/miniapp-route";
import { walletKey } from "@/lib/telegram/link";
import type { CoinInfo } from "@/lib/telegram/market";

const slim = (c: CoinInfo) => ({ mint: c.mint, ticker: c.ticker, name: c.name, image: c.image, priceUsd: c.priceUsd, marketCap: c.marketCap, change24h: c.change24h, volume24h: c.volume24h });

/** ?tab=trending | new, or ?q=<name, ticker or address>. The same sources as the bot's /trending, /new and /token. */
export async function GET(req: Request) {
  const g = await appGate(req, 60);
  if (g instanceof NextResponse) return g;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().replace(/^\$/, "");
  const { market } = appDeps();
  try {
    if (q) {
      if (q.length > 44 || !/^[A-Za-z0-9._ -]+$/.test(q)) return NextResponse.json({ coins: [] }, noStore);
      const mint = walletKey(q);
      if (mint) {
        const c = await market.coin(mint);
        return NextResponse.json({ coins: c ? [slim(c)] : [] }, noStore);
      }
      return NextResponse.json({ coins: (await market.search(q)).slice(0, 20).map(slim) }, noStore);
    }
    if (url.searchParams.get("tab") === "new") return NextResponse.json({ coins: (await market.pandaLaunches(20)).map((c) => ({ ...slim(c), launchedAt: c.launchedAt })) }, noStore);
    return NextResponse.json({ coins: (await market.mostTraded(20)).map(slim) }, noStore);
  } catch {
    return NextResponse.json({ error: "unavailable", code: "unavailable" }, { status: 503 });
  }
}
