/**
 * TEST-ONLY helpers for the Telegram bot (never imported by app code): a fake market, a config, deps on a PGlite database,
 * and a way to read what was queued.
 */
import { asc } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { telegramOutbox } from "@/lib/db/schema";
import type { BotDeps, Incoming } from "./commands";
import type { TelegramConfig } from "./config";
import type { CoinInfo, Market, Quote } from "./market";

export const PANDA = "zefa42tKR24WwpYZJujta7CDkD43n47soQwCoJpanda";
export const OTHER = "So11111111111111111111111111111111111111112";
export const ADMIN_TG = 1111;

export const coin = (mint: string, over: Partial<CoinInfo> = {}): CoinInfo => ({
  mint,
  ticker: "TST",
  name: "Test coin",
  image: null,
  priceUsd: 0.001,
  marketCap: 50_000,
  liquidityUsd: 20_000,
  change24h: 5,
  volume24h: 100_000,
  pool: null,
  ...over,
});

export function fakeMarket(over: Partial<Market> & { coins?: Record<string, CoinInfo>; quotesMap?: Map<string, Quote> } = {}): Market {
  const coins = over.coins ?? { [PANDA]: coin(PANDA, { ticker: "PANDA", name: "PANDA", pool: "POOL1" }), [OTHER]: coin(OTHER) };
  return {
    coin: async (mint) => coins[mint] ?? null,
    search: async () => [],
    mostTraded: async (n) => Object.values(coins).slice(0, n),
    quotes: async (mints) => over.quotesMap ?? new Map(mints.filter((m) => coins[m]).map((m) => [m, { priceUsd: coins[m].priceUsd, marketCap: coins[m].marketCap }])),
    pandaLaunches: async () => [],
    ...over,
  };
}

export function testConfig(over: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    enabled: true,
    hasToken: true,
    webhookSecret: "s".repeat(40),
    botUsername: "PandaTestBot",
    adminIds: new Set([ADMIN_TG]),
    channelId: "-1001",
    groupId: "-1002",
    topics: { newCoins: 11, buys: 12, payouts: 13, suggestions: 14 },
    minBuyUsd: 20,
    groupUrl: "https://t.me/pandacommunity",
    channelUrl: "https://t.me/pandaupdates",
    changelogEnabled: true,
    changelogSecret: "k".repeat(40),
    domain: "launchonpanda.app",
    siteUrl: "https://launchonpanda.app",
    ...over,
  };
}

export function botDeps(db: Db, over: Partial<BotDeps> = {}): BotDeps & { clock: { t: number }; audits: string[] } {
  const clock = { t: 1_800_000_000_000 };
  const audits: string[] = [];
  return {
    db,
    now: () => clock.t,
    cfg: testConfig(),
    market: fakeMarket(),
    isLimited: async () => false,
    audit: async (action) => void audits.push(action),
    ...over,
    clock,
    audits,
  };
}

let nextUser = 5000;
export const newUserId = () => ++nextUser;

export const dm = (fromId: number, text: string, lang: "en" | "es" = "en"): Incoming => ({ chatId: fromId, chatType: "private", fromId, lang, text });
export const inGroup = (fromId: number, text: string, threadId?: number): Incoming => ({ chatId: -1002, chatType: "supergroup", chatTitle: "PANDA", fromId, lang: "en", text, threadId });

/** Everything queued for `chatId`, oldest first: the text (or caption) and the raw row. */
export async function queued(db: Db, chatId: number | string) {
  const rows = await db.select().from(telegramOutbox).orderBy(asc(telegramOutbox.id));
  return rows
    .filter((r) => r.chatId === String(chatId))
    .map((r) => {
      const p = r.payload as Record<string, unknown>;
      return { text: String(p.text ?? p.caption ?? ""), payload: p, row: r };
    });
}
