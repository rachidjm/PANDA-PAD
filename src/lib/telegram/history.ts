import { tgEnqueue, type OutMessage } from "@/lib/db/telegram";
import { describeSplit, type BuyTrade, type FeedDeps } from "./feeds";
import { esc, shortAddr, tt, usd } from "./text";

/**
 * ONE-OFF: what happened BEFORE the bot existed, posted once to the group's topics (new coins, $PANDA buys, holder
 * payouts) in the same format as the automatic posts, oldest first, each with the real date and time of the event.
 * It only QUEUES messages (the outbox paces them to Telegram's limits) and it uses the SAME dedupe keys as the live
 * feeds, so nothing the bot already posted can be posted again. The live feeds themselves are not touched.
 */

const LANG = "en" as const;
const thread = (id: number | null) => (id ? { message_thread_id: id } : {});

/** "Oct 8, 2026 · 21:14 UTC" */
export function eventDate(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day} · ${time} UTC`;
}
/** The date goes right under the post's title line. */
const dated = (text: string, when: string) => text.replace("\n", `\n🕒 ${when}\n`);

export type HistoryLaunch = { mint: string; creator: string; launchedAt: number };
export type HistoryPayout = { mint: string; holdersPaid: number; lamportsPaid: number; finishedAt: number };

export type HistoryDeps = FeedDeps & {
  /** When the bot queued its very first message (≈ when it was switched on), or null if it never has. */
  botSince: () => Promise<number | null>;
  launches: () => Promise<HistoryLaunch[]>;
  payouts: () => Promise<HistoryPayout[]>;
  /** Every $PANDA buy before `until`, from the chain. `complete: false` = the scan ran out of time. */
  buys: (until: number) => Promise<{ buys: BuyTrade[]; complete: boolean; scanned: number }>;
  /** Which of these dedupe keys the bot has already queued or sent. */
  alreadyPosted: (keys: string[]) => Promise<Set<string>>;
};

export type HistoryItem = { at: number; topic: "newCoins" | "buys" | "payouts"; message: OutMessage };
export type HistoryReport = {
  until: number;
  topics: Record<HistoryItem["topic"], { found: number; alreadyPosted: number; queued: number; first: string | null; last: string | null; sample: string | null }>;
  buysComplete: boolean;
  buysScanned: number;
  dryRun: boolean;
};

/** Everything before the bot, as messages, oldest first. Nothing is written here. */
export async function buildHistory(d: HistoryDeps): Promise<{ until: number; items: HistoryItem[]; buysComplete: boolean; buysScanned: number }> {
  const until = (await d.botSince()) ?? d.now();
  const group = d.cfg.groupId;
  if (!group) return { until, items: [], buysComplete: true, buysScanned: 0 };
  const items: HistoryItem[] = [];

  // New coins: every coin launched on PANDA before the bot, from the first one.
  for (const r of (await d.launches()).filter((x) => x.launchedAt < until)) {
    const coin = await d.market.coin(r.mint).catch(() => null);
    const split = describeSplit(await d.feeSplit(r.mint).catch(() => null), { treasury: d.treasury, rewardsPool: d.rewardsPool, creator: r.creator });
    const text = dated(tt(LANG, "launchPost", { name: esc(coin?.name ?? "?"), ticker: esc(coin?.ticker ?? "?"), split: esc(split), mint: r.mint, nfa: tt(LANG, "nfa") }), eventDate(r.launchedAt));
    const button = { reply_markup: { inline_keyboard: [[{ text: tt(LANG, "viewOnPanda"), url: `${d.cfg.siteUrl}/coin/${r.mint}` }]] } };
    const image = coin?.image && /^https:\/\//.test(coin.image) ? coin.image : null;
    items.push({
      at: r.launchedAt,
      topic: "newCoins",
      message: image
        ? { chatId: group, method: "sendPhoto", dedupeKey: `launch:${r.mint}`, payload: { photo: image, caption: text, parse_mode: "HTML", ...button, ...thread(d.cfg.topics.newCoins) } }
        : { chatId: group, method: "sendMessage", dedupeKey: `launch:${r.mint}`, payload: { text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...button, ...thread(d.cfg.topics.newCoins) } },
    });
  }

  // $PANDA buys: every buy of at least the usual minimum, from its launch until the bot was switched on.
  const scan = await d.buys(until);
  for (const t of scan.buys.filter((x) => x.kind === "buy" && x.at < until && x.usd >= d.cfg.minBuyUsd)) {
    const text = dated(
      tt(LANG, "buyPost", { usd: usd(t.usd, LANG), sol: t.sol !== null ? ` · ${t.sol.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL` : "", wallet: shortAddr(t.wallet), tx: `https://solscan.io/tx/${t.txHash}`, nfa: tt(LANG, "nfa") }),
      eventDate(t.at)
    );
    items.push({ at: t.at, topic: "buys", message: { chatId: group, method: "sendMessage", dedupeKey: `buy:${t.txHash}`, payload: { text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...thread(d.cfg.topics.buys) } } });
  }

  // Holder payouts: one digest per UTC day that had any (each coin once in it). None → nothing.
  const days = new Map<string, { at: number; byMint: Map<string, { holders: number; lamports: number }> }>();
  for (const r of (await d.payouts()).filter((x) => x.finishedAt < until && x.holdersPaid > 0)) {
    const key = new Date(r.finishedAt).toISOString().slice(0, 10);
    const day = days.get(key) ?? { at: r.finishedAt, byMint: new Map() };
    day.at = Math.max(day.at, r.finishedAt);
    const cur = day.byMint.get(r.mint) ?? { holders: 0, lamports: 0 };
    day.byMint.set(r.mint, { holders: cur.holders + r.holdersPaid, lamports: cur.lamports + r.lamportsPaid });
    days.set(key, day);
  }
  for (const [key, day] of days) {
    const lines: string[] = [];
    for (const [mint, v] of [...day.byMint].slice(0, 20)) {
      const coin = await d.market.coin(mint).catch(() => null);
      lines.push(tt(LANG, "payoutLine", { ticker: coin ? `$${esc(coin.ticker)}` : shortAddr(mint), sol: (v.lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 }), holders: v.holders }));
    }
    const title = `💸 <b>Holder payouts</b> — paid on-chain:\n🕒 ${eventDate(day.at)}`;
    items.push({ at: day.at, topic: "payouts", message: { chatId: group, method: "sendMessage", dedupeKey: `payouts-history:${key}`, payload: { text: [title, ...lines].join("\n"), parse_mode: "HTML", ...thread(d.cfg.topics.payouts) } } });
  }

  items.sort((a, b) => a.at - b.at);
  return { until, items, buysComplete: scan.complete, buysScanned: scan.scanned };
}

/** Builds the history and (unless `dryRun`) queues it, oldest first. What the bot already posted is left alone. */
export async function publishHistory(d: HistoryDeps, opts: { dryRun: boolean }): Promise<HistoryReport> {
  const built = await buildHistory(d);
  const seen = await d.alreadyPosted(built.items.map((i) => i.message.dedupeKey!));
  const empty = () => ({ found: 0, alreadyPosted: 0, queued: 0, first: null as string | null, last: null as string | null, sample: null as string | null });
  const topics: HistoryReport["topics"] = { newCoins: empty(), buys: empty(), payouts: empty() };
  const now = d.now();
  for (const item of built.items) {
    const t = topics[item.topic];
    t.found++;
    if (seen.has(item.message.dedupeKey!)) {
      t.alreadyPosted++;
      continue;
    }
    // A scan that didn't finish must not publish a partial list of buys as if it were the whole history.
    if (item.topic === "buys" && !built.buysComplete) continue;
    if (!opts.dryRun && (await tgEnqueue(d.db, item.message, now)) === null) {
      t.alreadyPosted++;
      continue;
    }
    t.queued++;
    t.first ??= eventDate(item.at);
    t.last = eventDate(item.at);
    t.sample ??= String(item.message.payload.text ?? item.message.payload.caption ?? "");
  }
  return { until: built.until, topics, buysComplete: built.buysComplete, buysScanned: built.buysScanned, dryRun: opts.dryRun };
}

/**
 * A buy of `mint`, read from one confirmed transaction: a SIGNER whose balance of the coin went up, and the SOL that
 * left their wallet for it (the network fee aside). Anything else (a sell, a transfer, a failed transaction) → null.
 */
export function buyFromTransaction(
  tx: {
    blockTime?: number | null;
    meta?: { err?: unknown; fee?: number; preBalances?: number[]; postBalances?: number[]; preTokenBalances?: TokenBalance[] | null; postTokenBalances?: TokenBalance[] | null } | null;
    transaction: { signatures: string[]; message: { accountKeys: { pubkey: { toBase58(): string }; signer: boolean }[] } };
  } | null,
  mint: string,
  solUsd: number
): BuyTrade | null {
  if (!tx || !tx.meta || tx.meta.err || !tx.blockTime) return null;
  const keys = tx.transaction.message.accountKeys;
  const amount = (list: TokenBalance[] | null | undefined, owner: string) => (list ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? 0), 0);
  for (let k = 0; k < keys.length; k++) {
    if (!keys[k].signer) continue;
    const wallet = keys[k].pubkey.toBase58();
    if (!(amount(tx.meta.postTokenBalances, wallet) > amount(tx.meta.preTokenBalances, wallet))) continue;
    const spent = (tx.meta.preBalances?.[k] ?? 0) - (tx.meta.postBalances?.[k] ?? 0) - (k === 0 ? tx.meta.fee ?? 0 : 0);
    if (!(spent > 0)) return null; // paid with something other than SOL: its value can't be read from here
    const sol = spent / 1e9;
    return { txHash: tx.transaction.signatures[0], wallet, kind: "buy", usd: sol * solUsd, sol, at: tx.blockTime * 1000 };
  }
  return null;
}
type TokenBalance = { mint: string; owner?: string; uiTokenAmount: { uiAmount: number | null } };

/** The SOL price at a moment, from hourly candles (the candle of that hour, else the nearest one). 0 when there are none. */
export function solPriceAt(candles: { time: number; close: number }[], ms: number): number {
  if (candles.length === 0) return 0;
  const s = ms / 1000;
  let best = candles[0];
  for (const c of candles) {
    if (c.time <= s && s < c.time + 3600) return c.close;
    if (Math.abs(c.time - s) < Math.abs(best.time - s)) best = c;
  }
  return best.close;
}
