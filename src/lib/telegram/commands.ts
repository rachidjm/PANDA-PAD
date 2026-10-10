import type { Db } from "@/lib/db/client";
import {
  tgAddAlert,
  tgAddSuggestion,
  tgDeleteAlert,
  tgEnqueue,
  tgGetUser,
  tgOutboxCounts,
  tgStats,
  tgSuggestionsSince,
  tgTouchUser,
  tgUnlinkWallet,
  tgUnwatch,
  tgUserAlerts,
  tgWatch,
  tgWatchlist,
  type Lang,
} from "@/lib/db/telegram";
import { currentOf, fmtMetric, isCrossed, MAX_ALERTS, MAX_WATCH, parseAlertSpec } from "./alerts";
import type { TelegramConfig } from "./config";
import { pandaMint } from "./config";
import { createLinkCode, walletKey } from "./link";
import type { CoinInfo, Market } from "./market";
import { esc, price, shortAddr, tt, usd } from "./text";

/** A text message addressed to the bot, already validated (updates.ts). */
export type Incoming = {
  chatId: number;
  chatType: "private" | "group" | "supergroup" | "channel";
  chatTitle?: string;
  threadId?: number;
  fromId: number;
  lang: Lang;
  text: string;
};

export type BotDeps = {
  db: Db;
  now: () => number;
  cfg: TelegramConfig;
  market: Market;
  /** true = over the limit. */
  isLimited: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  audit: (action: string, object: string, data?: Record<string, unknown>) => Promise<void>;
  /** Tells Telegram a button press was received (stops its spinner). Best effort; absent in tests that don't need it. */
  answerCallback?: (callbackId: string, text?: string) => Promise<void>;
};

const PRIVATE_ONLY = new Set(["/watch", "/unwatch", "/watchlist", "/alert", "/alerts", "/link", "/unlink"]);
const KNOWN = new Set(["/start", "/help", "/new", "/trending", "/token", "/suggest", "/chatid", "/stats", ...PRIVATE_ONLY]);

/** "/token@PandaBot abc" → { cmd: "/token", args: ["abc"], forMe }. A command addressed to ANOTHER bot is not for us. */
export function parseCommand(text: string, botUsername: string | null): { cmd: string; args: string[]; rest: string; forMe: boolean } | null {
  const m = /^(\/[A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const rest = (m[3] ?? "").trim();
  const forMe = !m[2] || (!!botUsername && m[2].toLowerCase() === botUsername.toLowerCase());
  return { cmd: m[1].toLowerCase(), args: rest ? rest.split(/\s+/).slice(0, 8) : [], rest, forMe };
}

const coinUrl = (cfg: TelegramConfig, mint: string) => `${cfg.siteUrl}/coin/${mint}`;
const pct = (n: number | null, lang: Lang) => (n === null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toLocaleString(lang === "es" ? "es-ES" : "en-US", { maximumFractionDigits: 1 })}%`);

export function coinCard(c: CoinInfo, lang: Lang, official: boolean): string {
  return [
    `<b>${esc(c.name)}</b> ($${esc(c.ticker)})${official ? ` ✅ ${tt(lang, "official")}` : ""}`,
    `${tt(lang, "price")}: ${price(c.priceUsd, lang)} · ${tt(lang, "change24h")}: ${pct(c.change24h, lang)}`,
    `${tt(lang, "mcap")}: ${usd(c.marketCap, lang)} · ${tt(lang, "liquidity")}: ${usd(c.liquidityUsd, lang)}`,
    `<code>${c.mint}</code>`,
    "",
    tt(lang, "nfa"),
  ].join("\n");
}

/**
 * Handles one message. Everything the bot answers is queued (outbox) — the webhook flushes it right after, so replies are
 * immediate when Telegram is up and retried when it isn't. Throws nothing the caller must handle beyond a database outage.
 */
export async function handleMessage(d: BotDeps, m: Incoming): Promise<void> {
  const parsed = parseCommand(m.text, d.cfg.botUsername);
  // Only commands. In groups (privacy mode) the bot only receives commands and mentions anyway; plain chatter is ignored.
  if (!parsed || !parsed.forMe) return;
  const { cmd, args, rest } = parsed;
  const isPrivate = m.chatType === "private";
  if (!KNOWN.has(cmd)) {
    if (isPrivate) await say(d, m, tt(m.lang, "unknown"));
    return;
  }
  // Per Telegram user: 20 commands a minute. Over it, one short notice, then silence until the window passes.
  if (await d.isLimited(`tg:user:${m.fromId}`, 20, 60_000)) {
    if (!(await d.isLimited(`tg:user-notice:${m.fromId}`, 1, 60_000))) await say(d, m, tt(m.lang, "rateLimited"));
    return;
  }
  if (isPrivate) await tgTouchUser(d.db, m.fromId, m.lang, d.now());

  if (PRIVATE_ONLY.has(cmd) && !isPrivate) {
    const link = d.cfg.botUsername ? `https://t.me/${d.cfg.botUsername}` : "";
    await say(d, m, tt(m.lang, "privateOnly", { link }));
    return;
  }

  switch (cmd) {
    case "/start":
      return start(d, m, args[0]);
    case "/help":
      return say(d, m, tt(m.lang, "help"));
    case "/new":
      return newCoins(d, m);
    case "/trending":
      return trending(d, m);
    case "/token":
      return token(d, m, args);
    case "/watch":
      return watch(d, m, args);
    case "/unwatch":
      return unwatch(d, m, args);
    case "/watchlist":
      return watchlist(d, m);
    case "/alert":
      return alert(d, m, args);
    case "/alerts":
      return alertsList(d, m);
    case "/link":
      return link(d, m);
    case "/unlink":
      return unlink(d, m);
    case "/suggest":
      return suggest(d, m, rest);
    case "/chatid":
      return chatid(d, m);
    case "/stats":
      return stats(d, m);
  }
}

// ── replies ──────────────────────────────────────────────────────────────────────────────────────────────────────────
type Button = { text: string; url: string } | { text: string; callback_data: string };

/** The one button that isn't a link: "How alerts work" (bot.ts answers it with /help). */
export const CALLBACK_HELP = "help";

/** /start's buttons. The community and channel ones exist only when their public link is configured. */
export function startButtons(cfg: TelegramConfig, lang: Lang): Button[] {
  return [
    ...(cfg.groupUrl ? [{ text: tt(lang, "btnCommunity"), url: cfg.groupUrl }] : []),
    ...(cfg.channelUrl ? [{ text: tt(lang, "btnChannel"), url: cfg.channelUrl }] : []),
    { text: tt(lang, "btnOpen"), url: cfg.siteUrl },
    { text: tt(lang, "btnAlerts"), callback_data: CALLBACK_HELP },
  ];
}

/** A press of "How alerts work": the same answer as /help, in the chat where the button was. */
export async function showHelp(d: BotDeps, m: Incoming): Promise<void> {
  if (await d.isLimited(`tg:user:${m.fromId}`, 20, 60_000)) return;
  await say(d, m, tt(m.lang, "help"));
}

async function say(d: BotDeps, m: Incoming, text: string, buttons: Button[] = []): Promise<void> {
  await tgEnqueue(
    d.db,
    {
      chatId: String(m.chatId),
      method: "sendMessage",
      payload: {
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(m.threadId ? { message_thread_id: m.threadId } : {}),
        ...(buttons.length ? { reply_markup: { inline_keyboard: buttons.map((b) => [b]) } } : {}),
      },
    },
    d.now()
  );
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function start(d: BotDeps, m: Incoming, payload: string | undefined): Promise<void> {
  // A deep link's own flow comes FIRST, the welcome and its buttons after it.
  // t.me/<bot>?start=ref_<recruiter wallet or code>: the website applies it (the existing ?ref= / ?code= links), nothing is stored here.
  const ref = /^ref_([A-Za-z0-9_-]{3,44})$/.exec(payload ?? "")?.[1];
  if (ref) {
    const url = walletKey(ref) ? `${d.cfg.siteUrl}/?ref=${ref}` : `${d.cfg.siteUrl}/?code=${encodeURIComponent(ref)}`;
    await say(d, m, tt(m.lang, "refWelcome"), [{ text: tt(m.lang, "openPanda"), url }]);
  } else if (payload === "link" && m.chatType === "private") {
    // t.me/<bot>?start=link: straight into wallet linking (the same one-time link /link gives).
    await link(d, m);
  }
  await say(d, m, tt(m.lang, "welcome", { site: d.cfg.siteUrl.replace(/^https?:\/\//, ""), domain: d.cfg.domain }), startButtons(d.cfg, m.lang));
}

async function newCoins(d: BotDeps, m: Incoming): Promise<void> {
  let list: (CoinInfo & { launchedAt: number })[];
  try {
    list = await d.market.pandaLaunches(5);
  } catch {
    return say(d, m, tt(m.lang, "unavailable"));
  }
  if (list.length === 0) return say(d, m, tt(m.lang, "newNone"));
  const lines = list.map((c) => `• <a href="${coinUrl(d.cfg, c.mint)}">${esc(c.name)} ($${esc(c.ticker)})</a> · ${tt(m.lang, "mcap")} ${usd(c.marketCap, m.lang)}`);
  await say(d, m, [tt(m.lang, "newTitle"), ...lines, "", tt(m.lang, "nfa")].join("\n"));
}

async function trending(d: BotDeps, m: Incoming): Promise<void> {
  let list: CoinInfo[];
  try {
    list = await d.market.mostTraded(5);
  } catch {
    return say(d, m, tt(m.lang, "unavailable"));
  }
  if (list.length === 0) return say(d, m, tt(m.lang, "unavailable"));
  const lines = list.map((c, i) => `${i + 1}. <a href="${coinUrl(d.cfg, c.mint)}">$${esc(c.ticker)}</a> · ${tt(m.lang, "volume24h")} ${usd(c.volume24h, m.lang)} · ${tt(m.lang, "mcap")} ${usd(c.marketCap, m.lang)}`);
  await say(d, m, [tt(m.lang, "trendingTitle"), ...lines, "", tt(m.lang, "nfa")].join("\n"));
}

async function token(d: BotDeps, m: Incoming, args: string[]): Promise<void> {
  const q = args[0];
  if (!q || q.length > 44) return say(d, m, tt(m.lang, "tokenUsage"));
  const official = pandaMint();
  const asMint = walletKey(q);
  // Tickers are not unique: "PANDA" always means the official $PANDA, never a lookalike that happens to rank first.
  const mint = asMint ?? (q.replace(/^\$/, "").toUpperCase() === "PANDA" ? official : null);
  try {
    if (mint) {
      const c = await d.market.coin(mint);
      if (!c) return say(d, m, tt(m.lang, "tokenNotFound"));
      return say(d, m, coinCard(c, m.lang, c.mint === official), [{ text: tt(m.lang, "viewOnPanda"), url: coinUrl(d.cfg, c.mint) }]);
    }
    const ticker = q.replace(/^\$/, "");
    if (!/^[A-Za-z0-9._-]{1,20}$/.test(ticker)) return say(d, m, tt(m.lang, "tokenUsage"));
    const found = (await d.market.search(ticker)).filter((c) => c.ticker.toUpperCase() === ticker.toUpperCase()).slice(0, 5);
    if (found.length === 0) return say(d, m, tt(m.lang, "tokenNotFound"));
    if (found.length === 1) return say(d, m, coinCard(found[0], m.lang, found[0].mint === official), [{ text: tt(m.lang, "viewOnPanda"), url: coinUrl(d.cfg, found[0].mint) }]);
    const lines = found.map((c) => `• <a href="${coinUrl(d.cfg, c.mint)}">${esc(c.name)} ($${esc(c.ticker)})</a> · ${tt(m.lang, "mcap")} ${usd(c.marketCap, m.lang)}\n  <code>${c.mint}</code>`);
    return say(d, m, [tt(m.lang, "tokenMatches"), ...lines, "", tt(m.lang, "nfa")].join("\n"));
  } catch {
    return say(d, m, tt(m.lang, "unavailable"));
  }
}

async function watch(d: BotDeps, m: Incoming, args: string[]): Promise<void> {
  const mint = walletKey(args[0]);
  if (!mint) return say(d, m, tt(m.lang, "watchUsage"));
  const current = await tgWatchlist(d.db, m.fromId);
  const c = await d.market.coin(mint).catch(() => null);
  if (!c) return say(d, m, tt(m.lang, "tokenNotFound"));
  if (current.includes(mint)) return say(d, m, tt(m.lang, "watchExists", { ticker: `$${esc(c.ticker)}` }));
  if (current.length >= MAX_WATCH) return say(d, m, tt(m.lang, "watchFull", { max: MAX_WATCH }));
  await tgWatch(d.db, m.fromId, mint, d.now());
  await say(d, m, tt(m.lang, "watchAdded", { ticker: `$${esc(c.ticker)}` }));
}

async function unwatch(d: BotDeps, m: Incoming, args: string[]): Promise<void> {
  const mint = walletKey(args[0]);
  if (!mint) return say(d, m, tt(m.lang, "unwatchUsage"));
  await say(d, m, tt(m.lang, (await tgUnwatch(d.db, m.fromId, mint)) ? "unwatched" : "notWatched"));
}

async function watchlist(d: BotDeps, m: Incoming): Promise<void> {
  const mints = await tgWatchlist(d.db, m.fromId);
  if (mints.length === 0) return say(d, m, tt(m.lang, "watchlistEmpty"));
  let quotes: Awaited<ReturnType<Market["quotes"]>>;
  try {
    quotes = await d.market.quotes(mints);
  } catch {
    quotes = new Map();
  }
  const lines = mints.map((mint) => {
    const q = quotes.get(mint);
    return `• <a href="${coinUrl(d.cfg, mint)}">${shortAddr(mint)}</a> · ${price(q?.priceUsd ?? null, m.lang)} · ${tt(m.lang, "mcap")} ${usd(q?.marketCap ?? null, m.lang)}`;
  });
  await say(d, m, [tt(m.lang, "watchlistTitle"), ...lines, "", tt(m.lang, "nfa")].join("\n"));
}

async function alert(d: BotDeps, m: Incoming, args: string[]): Promise<void> {
  const example = pandaMint();
  if (args[0]?.toLowerCase() === "remove") {
    const n = Number(args[1]);
    const list = await tgUserAlerts(d.db, m.fromId);
    if (!Number.isInteger(n) || n < 1 || n > list.length) return say(d, m, tt(m.lang, "alertRemoveUsage"));
    await tgDeleteAlert(d.db, m.fromId, list[n - 1].id);
    return say(d, m, tt(m.lang, "alertRemoved"));
  }
  const mint = walletKey(args[0]);
  const spec = parseAlertSpec(args.slice(1));
  if (!mint || !spec) return say(d, m, tt(m.lang, "alertUsage", { example }));
  if ((await tgUserAlerts(d.db, m.fromId)).length >= MAX_ALERTS) return say(d, m, tt(m.lang, "alertFull", { max: MAX_ALERTS }));
  const c = await d.market.coin(mint).catch(() => null);
  if (!c) return say(d, m, tt(m.lang, "tokenNotFound"));
  const metricName = tt(m.lang, spec.metric === "price" ? "metricPrice" : "metricMcap");
  const current = currentOf({ priceUsd: c.priceUsd, marketCap: c.marketCap }, spec.metric);
  if (current !== null && isCrossed(spec, current)) return say(d, m, tt(m.lang, "alertAlreadyTrue", { metric: metricName, current: fmtMetric(spec.metric, current, m.lang) }));
  await tgAddAlert(d.db, { telegramId: m.fromId, mint, ticker: c.ticker.slice(0, 20), ...spec }, d.now());
  await say(d, m, tt(m.lang, "alertCreated", { ticker: `$${esc(c.ticker)}`, metric: metricName, direction: tt(m.lang, spec.direction), value: fmtMetric(spec.metric, spec.value, m.lang) }));
}

async function alertsList(d: BotDeps, m: Incoming): Promise<void> {
  const list = await tgUserAlerts(d.db, m.fromId);
  if (list.length === 0) return say(d, m, tt(m.lang, "alertsEmpty"));
  const lines = list.map(
    (a, i) =>
      `${i + 1}. $${esc(a.ticker)} ${tt(m.lang, a.metric === "price" ? "metricPrice" : "metricMcap")} ${tt(m.lang, a.direction as "above" | "below")} ${fmtMetric(a.metric as "price" | "mcap", a.value, m.lang)}`
  );
  await say(d, m, [tt(m.lang, "alertsTitle"), ...lines].join("\n"));
}

async function link(d: BotDeps, m: Incoming): Promise<void> {
  if (await d.isLimited(`tg:link:${m.fromId}`, 5, 3_600_000)) return say(d, m, tt(m.lang, "linkTooMany"));
  const { code } = await createLinkCode(d.db, m.fromId, d.now());
  await say(d, m, tt(m.lang, "linkIntro", { domain: d.cfg.domain }), [{ text: tt(m.lang, "linkButton"), url: `${d.cfg.siteUrl}/telegram/link?code=${code}` }]);
}

async function unlink(d: BotDeps, m: Incoming): Promise<void> {
  const user = await tgGetUser(d.db, m.fromId);
  if (!user?.wallet) return say(d, m, tt(m.lang, "notLinked"));
  await tgUnlinkWallet(d.db, m.fromId, d.now());
  await d.audit("telegram.unlink", String(m.fromId), { wallet: user.wallet });
  await say(d, m, tt(m.lang, "unlinked"));
}

async function suggest(d: BotDeps, m: Incoming, text: string): Promise<void> {
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!clean || clean.length > 1000) return say(d, m, tt(m.lang, "suggestUsage"));
  if ((await tgSuggestionsSince(d.db, m.fromId, d.now() - 86_400_000)) >= 5) return say(d, m, tt(m.lang, "suggestTooMany"));
  await tgAddSuggestion(d.db, m.fromId, clean, d.now());
  await say(d, m, tt(m.lang, "suggestSaved"));
}

async function chatid(d: BotDeps, m: Incoming): Promise<void> {
  if (!d.cfg.adminIds.has(m.fromId)) return; // not an admin: as if the command didn't exist
  await say(
    d,
    m,
    tt(m.lang, "chatId", {
      chatId: m.chatId,
      type: m.chatType,
      title: m.chatTitle ? `\n${esc(m.chatTitle)}` : "",
      thread: m.threadId ? `\nTopic (message_thread_id): <code>${m.threadId}</code>` : "",
    })
  );
}

async function stats(d: BotDeps, m: Incoming): Promise<void> {
  if (!d.cfg.adminIds.has(m.fromId)) return;
  const [s, q] = await Promise.all([tgStats(d.db, d.now()), tgOutboxCounts(d.db)]);
  await say(d, m, tt(m.lang, "stats", { ...s, ...q }));
}
