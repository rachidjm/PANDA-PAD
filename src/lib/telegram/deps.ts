import { Connection, PublicKey } from "@solana/web3.js";
import type { Coin } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import { tgLatestLaunches } from "@/lib/db/telegram";
import { getLiveCoin, getLiveCoinBase, getLiveCoins, searchLiveCoins } from "@/lib/live-coins";
import { fetchDexTokensBatch, type DexPair } from "@/lib/dexscreener/client";
import { fetchPoolTradesStrict } from "@/lib/gecko/client";
import { getFeeSharingConfig } from "@/lib/pump/fee-sharing";
import { getPendingFeeLocks } from "@/lib/pump/fee-lock";
import { PANDA_REWARDS_POOL, PANDA_TREASURY } from "@/lib/pump/constants";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { rateLimited } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit/log";
import { makeTelegramCall } from "./api";
import { pandaMint, telegramConfig } from "./config";
import type { BotDeps } from "./commands";
import type { FeedDeps } from "./feeds";
import type { CoinInfo, Market, Quote } from "./market";
import type { QueueDeps } from "./queue";

/** The real wiring (production). Tests use fakes of the same shapes. Data sources: docs/TELEGRAM.md §0. */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function coinInfo(c: Coin): CoinInfo {
  return {
    mint: c.mint,
    ticker: c.ticker,
    name: c.name,
    image: c.image ?? null,
    priceUsd: num(c.livePriceUsd),
    marketCap: num(c.marketCap),
    liquidityUsd: num(c.liquidityUsd),
    change24h: typeof c.changePct === "number" && Number.isFinite(c.changePct) ? c.changePct : null,
    volume24h: num(c.volume24h),
    pool: c.poolAddress ?? null,
  };
}

/** Of a token's Dexscreener pairs, the one with the most liquidity (a curve pair has none listed: then the first). */
export function bestPairQuote(pairs: DexPair[]): Quote | null {
  if (pairs.length === 0) return null;
  const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  return { priceUsd: num(Number(best.priceUsd)), marketCap: num(best.marketCap) ?? num(best.fdv) };
}

export const realMarket: Market = {
  async coin(mint) {
    const { coin } = await getLiveCoin(mint);
    return coin ? coinInfo(coin) : null;
  },
  async search(query) {
    const { coins } = await searchLiveCoins(query);
    return coins.map(coinInfo);
  },
  async mostTraded(n) {
    const { coins } = await getLiveCoins(); // the shared cache the warm-coins cron keeps fresh every minute: no extra upstream call
    return [...coins].sort((a, b) => b.volume24h - a.volume24h).slice(0, n).map(coinInfo);
  },
  async quotes(mints) {
    // One batched Dexscreener call per 30 coins, per run — however many users watch them.
    const out = new Map<string, Quote>();
    const unique = [...new Set(mints)];
    for (let i = 0; i < unique.length && i < 300; i += 30) {
      const pairs = await fetchDexTokensBatch(unique.slice(i, i + 30));
      for (const mint of unique.slice(i, i + 30)) {
        const q = bestPairQuote(pairs.filter((p) => p.baseToken.address === mint));
        if (q) out.set(mint, q);
      }
    }
    return out;
  },
  async pandaLaunches(n) {
    const rows = await tgLatestLaunches(getDb(), n);
    const out: (CoinInfo & { launchedAt: number })[] = [];
    for (const r of rows) {
      const { coin } = await getLiveCoinBase(r.mint).catch(() => ({ coin: undefined }));
      out.push({ ...(coin ? coinInfo(coin) : { mint: r.mint, ticker: "?", name: "?", image: null, priceUsd: null, marketCap: null, liquidityUsd: null, change24h: null, volume24h: null }), launchedAt: r.launchedAt });
    }
    return out;
  },
};

export function realBotDeps(): BotDeps {
  return {
    db: getDb(),
    now: Date.now,
    cfg: telegramConfig(),
    market: realMarket,
    isLimited: rateLimited,
    audit: (action, object, data) => recordAudit({ actor: "system:telegram", action, object, ...(data ? { newState: data } : {}) }),
    editMessage: async (chatId, messageId, payload) => void (await makeTelegramCall()("editMessageText", { chat_id: chatId, message_id: messageId, ...payload })),
    answerCallback: async (callbackId, text) => void (await makeTelegramCall()("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) })),
  };
}

export function realQueueDeps(): QueueDeps {
  return { db: getDb(), call: makeTelegramCall(), now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))) };
}

export function realFeedDeps(): FeedDeps {
  const connection = new Connection(serverRpcUrl(), "confirmed");
  return {
    db: getDb(),
    now: Date.now,
    cfg: telegramConfig(),
    market: realMarket,
    pandaMint: pandaMint(),
    feeSplit: (mint) => getFeeSharingConfig(connection, new PublicKey(mint)),
    feeLockPending: async (mint) => mint in (await getPendingFeeLocks()),
    trades: async (pool) =>
      (await fetchPoolTradesStrict(pool)).map((t) => ({
        txHash: t.attributes.tx_hash,
        wallet: t.attributes.tx_from_address,
        kind: t.attributes.kind,
        usd: Number(t.attributes.volume_in_usd) || 0,
        sol: t.attributes.kind === "buy" ? Number(t.attributes.from_token_amount) || null : null,
        at: Date.parse(t.attributes.block_timestamp),
      })),
    treasury: PANDA_TREASURY.toBase58(),
    rewardsPool: PANDA_REWARDS_POOL?.toBase58() ?? null,
  };
}
