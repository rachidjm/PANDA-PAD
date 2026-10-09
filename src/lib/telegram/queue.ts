import type { Db } from "@/lib/db/client";
import { tgDueOutbox, tgEnqueue, tgMarkFailed, tgMarkRetry, tgMarkSent, tgSentSince, tgSetBlocked, type OutboxRow } from "@/lib/db/telegram";
import type { TelegramCall } from "./api";

/**
 * Sends what's in the outbox, paced to Telegram's documented limits (core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this):
 * about 30 messages/second overall, 1/second to one private chat, 20/minute to one group or channel. A failure never throws
 * out of here and never blocks anything else in PANDA: it's retried with growing waits, honouring Telegram's own retry_after.
 */

export const GLOBAL_PER_SECOND = 25;
export const GROUP_PER_MINUTE = 20;
export const MAX_ATTEMPTS = 6;

export type QueueDeps = { db: Db; call: TelegramCall; now: () => number; sleep: (ms: number) => Promise<void> };
export type QueueReport = { sent: number; retried: number; failed: number; deferred: number };

const isPrivate = (chatId: string) => !chatId.startsWith("-");
/** 15 s, 30 s, 1 min, 2 min, 4 min… capped at 1 hour. */
export const backoffMs = (attempts: number) => Math.min(15_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);

/** When this chat may next receive a message, or 0 if now. */
async function chatWait(db: Db, chatId: string, now: number): Promise<number> {
  if (isPrivate(chatId)) return (await tgSentSince(db, chatId, now - 1_000)) >= 1 ? 1_000 : 0;
  return (await tgSentSince(db, chatId, now - 60_000)) >= GROUP_PER_MINUTE ? 3_000 : 0;
}

async function sendOne(d: QueueDeps, row: OutboxRow, report: QueueReport): Promise<void> {
  const now = d.now();
  const r = await d.call(row.method, { ...(row.payload as Record<string, unknown>), chat_id: row.chatId });
  if (r.ok) {
    await tgMarkSent(d.db, row.id, d.now());
    report.sent++;
    return;
  }
  const attempts = row.attempts + 1;
  const why = `${r.errorCode} ${r.description ?? ""}`.trim();
  if (r.errorCode === 429) {
    await tgMarkRetry(d.db, row.id, row.attempts, now + Math.max(1, r.retryAfter ?? 5) * 1000, why); // Telegram's own wait; not counted as a failure
    report.retried++;
    return;
  }
  // A photo Telegram can't fetch must not lose the post: send it again as text.
  if (row.method === "sendPhoto" && r.errorCode === 400) {
    const p = row.payload as Record<string, unknown>;
    await tgMarkFailed(d.db, row.id, attempts, why);
    await tgEnqueue(d.db, { chatId: row.chatId, method: "sendMessage", payload: { text: p.caption ?? "", parse_mode: p.parse_mode, reply_markup: p.reply_markup, message_thread_id: p.message_thread_id }, dedupeKey: row.dedupeKey ? `${row.dedupeKey}:text` : undefined }, now);
    report.failed++;
    return;
  }
  // 400 / 403 / 404: retrying can't help (bad request, the user blocked the bot, the chat is gone).
  if (r.errorCode >= 400 && r.errorCode < 500) {
    await tgMarkFailed(d.db, row.id, attempts, why);
    if (r.errorCode === 403 && isPrivate(row.chatId)) await tgSetBlocked(d.db, Number(row.chatId), now);
    report.failed++;
    return;
  }
  // Network, timeout, 5xx: try again later.
  if (attempts >= MAX_ATTEMPTS) {
    await tgMarkFailed(d.db, row.id, attempts, why);
    report.failed++;
  } else {
    await tgMarkRetry(d.db, row.id, attempts, now + backoffMs(attempts), why);
    report.retried++;
  }
}

/** Works through due messages until the queue is empty or `budgetMs` runs out. */
export async function processOutbox(d: QueueDeps, budgetMs: number): Promise<QueueReport> {
  const report: QueueReport = { sent: 0, retried: 0, failed: 0, deferred: 0 };
  const start = d.now();
  const stamps: number[] = []; // send times in this run, for the global pace
  const skipped = new Set<number>();
  while (d.now() - start < budgetMs) {
    const due = (await tgDueOutbox(d.db, d.now(), 50)).filter((r) => !skipped.has(r.id));
    if (due.length === 0) break;
    for (const row of due) {
      if (d.now() - start >= budgetMs) break;
      const wait = await chatWait(d.db, row.chatId, d.now());
      if (wait > 0) {
        await tgMarkRetry(d.db, row.id, row.attempts, d.now() + wait, row.lastError ?? "paced");
        skipped.add(row.id);
        report.deferred++;
        continue;
      }
      while (stamps.length && d.now() - stamps[0] >= 1_000) stamps.shift();
      if (stamps.length >= GLOBAL_PER_SECOND) await d.sleep(1_000 - (d.now() - stamps[0]));
      stamps.push(d.now());
      try {
        await sendOne(d, row, report);
      } catch (err) {
        // A database hiccup on one row: leave it pending, move on.
        console.warn("[PANDA telegram] outbox row failed", row.id, err instanceof Error ? err.name : "error");
        skipped.add(row.id);
      }
    }
  }
  return report;
}
