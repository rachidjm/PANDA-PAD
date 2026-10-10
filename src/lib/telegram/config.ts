import { isEnabled } from "@/lib/config/flags";
import { siteDomain, siteUrl } from "@/lib/config/site";

/**
 * The Telegram bot's settings, read from the environment (names in .env.example / src/lib/config/env.ts — values only in
 * Vercel). Everything is optional until FEATURE_TELEGRAM_BOT is on; a missing id simply switches that one post off.
 */

export type Env = Record<string, string | undefined>;

export type TelegramConfig = {
  enabled: boolean;
  hasToken: boolean;
  webhookSecret: string | null;
  botUsername: string | null;
  adminIds: Set<number>;
  channelId: string | null;
  groupId: string | null;
  topics: { newCoins: number | null; buys: number | null; payouts: number | null; suggestions: number | null };
  minBuyUsd: number;
  /** Public invite links (not secrets): where the "Join the Community" / "Updates channel" / "Discuss" buttons point. Unset → no button. */
  groupUrl: string | null;
  channelUrl: string | null;
  /** "launchonpanda.app" — what the wallet-linking message names, and where the bot's links point. */
  domain: string;
  siteUrl: string;
};

const chatId = (v: string | undefined) => (v && /^-?\d{1,20}$/.test(v.trim()) ? v.trim() : null);
/** Only an https://t.me/… (or telegram.me) link is accepted as a button target. */
export const telegramUrl = (v: string | undefined) => (v && /^https:\/\/(t|telegram)\.me\/[A-Za-z0-9_+\/-]{2,128}$/.test(v.trim()) ? v.trim() : null);
const topic = (v: string | undefined) => (v && /^\d{1,12}$/.test(v.trim()) ? Number(v.trim()) : null);

export function telegramConfig(env: Env = process.env): TelegramConfig {
  const min = Number(env.TELEGRAM_MIN_BUY_USD);
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  return {
    enabled: isEnabled("TELEGRAM_BOT", env),
    hasToken: !!env.TELEGRAM_BOT_TOKEN?.trim(),
    webhookSecret: /^[A-Za-z0-9_-]{32,256}$/.test(secret) ? secret : null,
    botUsername: env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null,
    adminIds: new Set(
      (env.TELEGRAM_ADMIN_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d{1,16}$/.test(s))
        .map(Number)
    ),
    channelId: chatId(env.TELEGRAM_CHANNEL_ID),
    groupId: chatId(env.TELEGRAM_GROUP_ID),
    topics: { newCoins: topic(env.TELEGRAM_TOPIC_NEW_COINS), buys: topic(env.TELEGRAM_TOPIC_BUYS), payouts: topic(env.TELEGRAM_TOPIC_PAYOUTS), suggestions: topic(env.TELEGRAM_TOPIC_SUGGESTIONS) },
    minBuyUsd: Number.isFinite(min) && min > 0 ? min : 20,
    groupUrl: telegramUrl(env.TELEGRAM_GROUP_URL),
    channelUrl: telegramUrl(env.TELEGRAM_CHANNEL_URL),
    domain: siteDomain(),
    siteUrl: siteUrl(),
  };
}

/** The official $PANDA mint (NEXT_PUBLIC_PANDA_TOKEN_MINT). A ticker search for "PANDA" always answers with this one. */
export const PANDA_MINT_FALLBACK = "zefa42tKR24WwpYZJujta7CDkD43n47soQwCoJpanda";
export const pandaMint = (env: Env = process.env) => env.NEXT_PUBLIC_PANDA_TOKEN_MINT?.trim() || PANDA_MINT_FALLBACK;
