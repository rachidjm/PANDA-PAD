import { isEnabled } from "@/lib/config/flags";

/**
 * What the WEBSITE may know about the bot: its public @username, and only while the bot is switched on. Nothing else of
 * the bot's settings ever goes to the browser.
 */
export function publicBotUsername(env: Record<string, string | undefined> = process.env): string | null {
  if (!isEnabled("TELEGRAM_BOT", env)) return null;
  const name = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";
  return /^[A-Za-z0-9_]{5,32}$/.test(name) ? name : null;
}

/** Where the site's "Join us on Telegram" button goes: the bot, started with a tag that says the visit came from the web. */
export const WEB_START = "web";
export const botStartUrl = (username: string, payload = WEB_START) => `https://t.me/${username}?start=${payload}`;
