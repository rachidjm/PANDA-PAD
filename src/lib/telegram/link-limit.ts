/**
 * How many one-time wallet-linking links one Telegram account may ask for: 5 in 10 minutes, counted together whether
 * they come from the bot (/link, or the "start=link" deep link) or from the Mini App's "Link my wallet" button.
 * A plain /start is not a request for a link and is never counted.
 */
export const LINK_LIMIT = 5;
export const LINK_WINDOW_MS = 10 * 60_000;
export const LINK_WAIT_MINUTES = LINK_WINDOW_MS / 60_000;

/** The page where the wallet signs the link (the same address the bot's button opens). */
export const linkPageUrl = (siteUrl: string, code: string) => `${siteUrl.replace(/\/+$/, "")}/telegram/link?code=${code}`;
