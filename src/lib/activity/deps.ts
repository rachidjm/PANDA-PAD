import { fetchDexPools, fetchPoolTradesStrict, tokenIdToAddress } from "@/lib/gecko/client";
import { fetchNewestPumpCoins, fetchPumpCoins } from "@/lib/pump/frontend-api";
import { getLiveCoin, getLiveCoins } from "@/lib/live-coins";
import { withoutPendingFeeLock } from "@/lib/pump/fee-lock";
import type { Coin } from "@/lib/types";
import { ACTIVITY_CONFIG as C } from "./config";
import { readJournal } from "./journal";
import { graduationToEvent, launchToEvent, tradeToEvent } from "./mappers";
import type { FeedDeps } from "./service";
import type { CoinMeta, FeedEvent } from "./types";

/**
 * The real wiring. The market indexer is GeckoTerminal (public pool trades and pools, read from the
 * chain) plus Pump.fun's own public API for launches and graduation status — both third parties that
 * can change or rate-limit at any time, which is why every source here is optional and reported
 * individually; replacing one means editing only this file.
 */

const metaOf = (c: Coin): CoinMeta => ({ ticker: c.ticker, name: c.name, image: c.image });
const solQuoted = (c: Coin) => !!c.poolAddress && (c.quoteSymbol ?? "SOL").toUpperCase() === "SOL";

async function tradesOf(coin: Coin, take: number): Promise<FeedEvent[]> {
  const raw = await fetchPoolTradesStrict(coin.poolAddress as string);
  return raw
    .slice(0, take)
    .map((t) => tradeToEvent(t, coin.mint, metaOf(coin)))
    .filter((e): e is FeedEvent => e !== null);
}

export function realFeedDeps(): FeedDeps {
  return {
    now: () => Date.now(),
    journal: readJournal,

    trades: async (mint) => {
      if (mint) {
        const { coin } = await getLiveCoin(mint);
        return coin && solQuoted(coin) ? tradesOf(coin, 30) : [];
      }
      const { coins } = await getLiveCoins();
      const top = coins.filter(solQuoted).sort((a, b) => b.volume24h - a.volume24h).slice(0, C.marketCoins);
      const settled = await Promise.allSettled(top.map((c) => tradesOf(c, C.tradesPerCoin)));
      // Partial answers are fine; if every request failed (rate limit, outage) that is an outage, not "no trades".
      if (settled.length > 0 && settled.every((r) => r.status === "rejected")) throw new Error("trade indexer unavailable");
      return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    },

    // Coins still waiting for their fee split (two-transaction launches) are kept out of the feed.
    launches: async () => (await withoutPendingFeeLock(await fetchNewestPumpCoins(60))).map(launchToEvent).filter((e): e is FeedEvent => e !== null),

    graduations: async () => {
      const now = Date.now();
      const res = await fetchDexPools("pumpswap", 1);
      const recent = res.data.filter((p) => {
        const t = p.attributes.pool_created_at ? Date.parse(p.attributes.pool_created_at) : NaN;
        return Number.isFinite(t) && now - t <= C.graduationWindowMs;
      });
      if (recent.length === 0) return [];
      const mintOf = (id: string) => tokenIdToAddress(id);
      const pumpCoins = await fetchPumpCoins(recent.map((p) => mintOf(p.relationships.base_token.data.id)));
      const events = recent
        .map((p) => {
          const mint = mintOf(p.relationships.base_token.data.id);
          return graduationToEvent(p, mint, pumpCoins.get(mint), now);
        })
        .filter((e): e is FeedEvent => e !== null);
      return withoutPendingFeeLock(events);
    },

    meta: async (mints) => {
      const out = new Map<string, CoinMeta>();
      const { coins } = await getLiveCoins();
      const byMint = new Map(coins.map((c) => [c.mint, c]));
      const missing: string[] = [];
      for (const m of mints) {
        const c = byMint.get(m);
        if (c) out.set(m, metaOf(c));
        else missing.push(m);
      }
      if (missing.length) {
        for (const [m, p] of await fetchPumpCoins(missing)) out.set(m, { ticker: p.symbol, name: p.name, image: p.image });
      }
      return out;
    },
  };
}
