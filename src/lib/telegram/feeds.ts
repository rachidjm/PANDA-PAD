import type { Db } from "@/lib/db/client";
import { tgEnqueue, tgGetState, tgLastLaunchAt, tgLaunchesSince, tgPayoutRunsSince, tgSetState, type Lang, type OutMessage } from "@/lib/db/telegram";
import type { TelegramConfig } from "./config";
import type { Market } from "./market";
import { esc, shortAddr, tt, usd } from "./text";

/**
 * The automatic posts (docs/TELEGRAM.md §2). Each one reads a VERIFIED source, keeps a small cursor so nothing is posted twice
 * (and, on its very first run, starts from "now" — it never floods the group with history), and only QUEUES messages:
 * Telegram being slow or down never touches the source it reads. Group posts are in English (the group's language).
 */

export type BuyTrade = { txHash: string; wallet: string; kind: "buy" | "sell"; usd: number; sol: number | null; at: number };
export type PayoutRun = { mint: string; holdersPaid: number; lamportsPaid: number };

export type FeedDeps = {
  db: Db;
  now: () => number;
  cfg: TelegramConfig;
  market: Market;
  pandaMint: string;
  /** The coin's on-chain fee split (Pump.fun SharingConfig), or null if unreadable / none. */
  feeSplit: (mint: string) => Promise<{ address: string; shareBps: number }[] | null>;
  /** True while a two-transaction launch's fee split isn't on-chain yet (the site hides those coins too). */
  feeLockPending: (mint: string) => Promise<boolean>;
  /** Latest trades of a pool (GeckoTerminal), newest first. Throws on a failed read (so a failure never looks like "no buys"). */
  trades: (pool: string) => Promise<BuyTrade[]>;
  treasury: string;
  rewardsPool: string | null;
};

const LANG: Lang = "en";
const thread = (id: number | null) => (id ? { message_thread_id: id } : {});
const pctOf = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export function describeSplit(split: { address: string; shareBps: number }[] | null, who: { treasury: string; rewardsPool: string | null; creator: string }): string {
  if (!split || split.length === 0) return tt(LANG, "splitUnknown");
  return split
    .map((s) => {
      const label = s.address === who.treasury ? tt(LANG, "splitPanda") : who.rewardsPool && s.address === who.rewardsPool ? tt(LANG, "splitHolders") : s.address === who.creator ? tt(LANG, "splitCreator") : tt(LANG, "splitPartner");
      return `${label} ${pctOf(s.shareBps)}`;
    })
    .join(" · ");
}

// ── new coins launched on PANDA → group, "New coins" topic ──────────────────────────────────────────────────────────
export async function postNewLaunches(d: FeedDeps): Promise<number> {
  const now = d.now();
  const cursor = await tgGetState<number>(d.db, "launches.cursor");
  if (cursor === null) {
    await tgSetState(d.db, "launches.cursor", await tgLastLaunchAt(d.db), now);
    return 0;
  }
  const rows = await tgLaunchesSince(d.db, cursor, 10);
  let next = cursor;
  let posted = 0;
  for (const r of rows) {
    // A two-transaction launch whose fee split isn't on-chain yet: wait for it (up to 2 h), as the site does.
    if (await d.feeLockPending(r.mint)) {
      if (now - r.launchedAt < 2 * 3_600_000) break;
      next = r.launchedAt;
      continue;
    }
    const coin = await d.market.coin(r.mint).catch(() => null);
    if (!coin && now - r.launchedAt < 30 * 60_000) break; // not indexed yet: try again next minute
    if (d.cfg.groupId) {
      const split = describeSplit(await d.feeSplit(r.mint).catch(() => null), { treasury: d.treasury, rewardsPool: d.rewardsPool, creator: r.creator });
      const text = tt(LANG, "launchPost", { name: esc(coin?.name ?? "?"), ticker: esc(coin?.ticker ?? "?"), split: esc(split), mint: r.mint, nfa: tt(LANG, "nfa") });
      const button = { reply_markup: { inline_keyboard: [[{ text: tt(LANG, "viewOnPanda"), url: `${d.cfg.siteUrl}/coin/${r.mint}` }]] } };
      const image = coin?.image && /^https:\/\//.test(coin.image) ? coin.image : null;
      const msg: OutMessage = image
        ? { chatId: d.cfg.groupId, method: "sendPhoto", dedupeKey: `launch:${r.mint}`, payload: { photo: image, caption: text, parse_mode: "HTML", ...button, ...thread(d.cfg.topics.newCoins) } }
        : { chatId: d.cfg.groupId, method: "sendMessage", dedupeKey: `launch:${r.mint}`, payload: { text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...button, ...thread(d.cfg.topics.newCoins) } };
      if ((await tgEnqueue(d.db, msg, now)) !== null) posted++;
    }
    next = r.launchedAt;
  }
  if (next !== cursor) await tgSetState(d.db, "launches.cursor", next, now);
  return posted;
}

// ── $PANDA buys → group ─────────────────────────────────────────────────────────────────────────────────────────────
const MAX_BUY_POSTS = 5;

export async function postPandaBuys(d: FeedDeps): Promise<number> {
  if (!d.cfg.groupId) return 0;
  const now = d.now();
  // The pool moves when $PANDA graduates from the curve to PumpSwap: re-read it every hour.
  let poolState = await tgGetState<{ pool: string; at: number }>(d.db, "buys.pool");
  if (!poolState || now - poolState.at > 3_600_000) {
    const coin = await d.market.coin(d.pandaMint).catch(() => null);
    if (coin?.pool) {
      poolState = { pool: coin.pool, at: now };
      await tgSetState(d.db, "buys.pool", poolState, now);
    }
  }
  if (!poolState) return 0;
  const cursor = await tgGetState<number>(d.db, "buys.cursor");
  if (cursor === null) {
    await tgSetState(d.db, "buys.cursor", now, now);
    return 0;
  }
  const trades = await d.trades(poolState.pool); // a failed read throws: the cursor doesn't move, nothing is lost
  // ">=": trades share whole seconds; the dedupe key stops a second post of the same transaction.
  const buys = trades.filter((t) => t.kind === "buy" && t.at >= cursor && t.usd >= d.cfg.minBuyUsd).sort((a, b) => a.at - b.at);
  let posted = 0;
  for (const t of buys.slice(0, MAX_BUY_POSTS)) {
    const text = tt(LANG, "buyPost", {
      usd: usd(t.usd, LANG),
      sol: t.sol !== null ? ` · ${t.sol.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL` : "",
      wallet: shortAddr(t.wallet),
      tx: `https://solscan.io/tx/${t.txHash}`,
      nfa: tt(LANG, "nfa"),
    });
    const id = await tgEnqueue(d.db, { chatId: d.cfg.groupId, method: "sendMessage", dedupeKey: `buy:${t.txHash}`, payload: { text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...thread(d.cfg.topics.buys) } }, now);
    if (id !== null) posted++;
  }
  if (buys.length > MAX_BUY_POSTS) {
    const last = buys[buys.length - 1];
    await tgEnqueue(
      d.db,
      { chatId: d.cfg.groupId, method: "sendMessage", dedupeKey: `buys-more:${last.txHash}`, payload: { text: tt(LANG, "buyMore", { n: buys.length - MAX_BUY_POSTS, min: usd(d.cfg.minBuyUsd, LANG) }), ...thread(d.cfg.topics.buys) } },
      now
    );
  }
  const newest = trades.reduce((m, t) => Math.max(m, t.at), cursor);
  if (newest > cursor) await tgSetState(d.db, "buys.cursor", newest, now);
  return posted;
}

// ── holder payouts → group, ONE digest per hour (each coin at most once in it) ─────────────────────────────────────
export async function postPayoutDigest(d: FeedDeps): Promise<number> {
  if (!d.cfg.groupId) return 0;
  const now = d.now();
  const last = await tgGetState<number>(d.db, "payouts.digestAt");
  if (last === null) {
    await tgSetState(d.db, "payouts.digestAt", now, now);
    return 0;
  }
  if (now - last < 3_600_000) return 0;
  const runs = await tgPayoutRunsSince(d.db, last);
  const byMint = new Map<string, { holders: number; lamports: number }>();
  for (const r of runs) {
    const cur = byMint.get(r.mint) ?? { holders: 0, lamports: 0 };
    byMint.set(r.mint, { holders: cur.holders + r.holdersPaid, lamports: cur.lamports + r.lamportsPaid });
  }
  if (byMint.size > 0) {
    const lines: string[] = [];
    for (const [mint, v] of [...byMint].slice(0, 20)) {
      const coin = await d.market.coin(mint).catch(() => null);
      lines.push(tt(LANG, "payoutLine", { ticker: coin ? `$${esc(coin.ticker)}` : shortAddr(mint), sol: (v.lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 }), holders: v.holders }));
    }
    await tgEnqueue(d.db, { chatId: d.cfg.groupId, method: "sendMessage", dedupeKey: `payouts:${last}`, payload: { text: [tt(LANG, "payoutsTitle"), ...lines].join("\n"), parse_mode: "HTML", ...thread(d.cfg.topics.payouts) } }, now);
  }
  await tgSetState(d.db, "payouts.digestAt", now, now);
  return byMint.size;
}

// ── official announcements (from /admin) → channel ─────────────────────────────────────────────────────────────────
export type Announcement = { text: string; imageUrl?: string; buttonText?: string; buttonUrl?: string };

/**
 * Validates an announcement and builds the message. Text is sent as plain text (escaped): no markup can be injected.
 * `groupUrl`: every announcement ends with a "Discuss in Community" button to the group — the channel and the group can't be
 * linked (the group uses Topics), so this stands in for comments. No link configured → no such button.
 */
export function buildAnnouncement(a: Announcement, channelId: string, groupUrl: string | null = null): { ok: true; message: OutMessage } | { ok: false; error: string } {
  const text = typeof a.text === "string" ? a.text.trim() : "";
  const image = a.imageUrl?.trim() || "";
  const bText = a.buttonText?.trim() || "";
  const bUrl = a.buttonUrl?.trim() || "";
  if (!text) return { ok: false, error: "The text is empty." };
  if (text.length > (image ? 1000 : 3500)) return { ok: false, error: image ? "With an image, the text can be up to 1000 characters." : "The text can be up to 3500 characters." };
  if (image && !/^https:\/\/\S{4,500}$/.test(image)) return { ok: false, error: "The image must be an https:// URL." };
  if ((bText && !bUrl) || (!bText && bUrl)) return { ok: false, error: "A button needs both a label and a link." };
  if (bText && bText.length > 40) return { ok: false, error: "The button label can be up to 40 characters." };
  if (bUrl && !/^https:\/\/\S{4,500}$/.test(bUrl)) return { ok: false, error: "The button link must be an https:// URL." };
  const rows = [...(bText ? [[{ text: bText, url: bUrl }]] : []), ...(groupUrl ? [[{ text: tt(LANG, "btnDiscuss"), url: groupUrl }]] : [])];
  const markup = rows.length ? { reply_markup: { inline_keyboard: rows } } : {};
  const message: OutMessage = image
    ? { chatId: channelId, method: "sendPhoto", payload: { photo: image, caption: esc(text), parse_mode: "HTML", ...markup } }
    : { chatId: channelId, method: "sendMessage", payload: { text: esc(text), parse_mode: "HTML", ...markup } };
  return { ok: true, message };
}
