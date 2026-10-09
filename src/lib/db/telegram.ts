import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, max, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import { holderPayoutRuns, pandaLaunches, telegramAlerts, telegramLinkCodes, telegramOutbox, telegramState, telegramSuggestions, telegramUpdates, telegramUsers, telegramWatchlist } from "./schema";

/** The Telegram bot's tables (src/lib/telegram). Every "only once" rule is a conditional statement, never read-then-write. */

export type Lang = "en" | "es";
export type TelegramUserRow = typeof telegramUsers.$inferSelect;
export type OutboxRow = typeof telegramOutbox.$inferSelect;
export type AlertRow = typeof telegramAlerts.$inferSelect;

// ── users ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Creates the user on first contact, keeps their language current (and clears `blocked`: they're talking to the bot again). */
export async function tgTouchUser(db: Db, telegramId: number, lang: Lang, now: number): Promise<TelegramUserRow> {
  const [row] = await db
    .insert(telegramUsers)
    .values({ telegramId, lang, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: telegramUsers.telegramId, set: { lang, blocked: false, updatedAt: now } })
    .returning();
  return row;
}

export async function tgGetUser(db: Db, telegramId: number): Promise<TelegramUserRow | null> {
  const [row] = await db.select().from(telegramUsers).where(eq(telegramUsers.telegramId, telegramId));
  return row ?? null;
}

export async function tgSetBlocked(db: Db, telegramId: number, now: number): Promise<void> {
  await db.update(telegramUsers).set({ blocked: true, updatedAt: now }).where(eq(telegramUsers.telegramId, telegramId));
}

export async function tgUnlinkWallet(db: Db, telegramId: number, now: number): Promise<string | null> {
  const [row] = await db
    .update(telegramUsers)
    .set({ wallet: null, linkedAt: null, updatedAt: now })
    .where(and(eq(telegramUsers.telegramId, telegramId), sql`${telegramUsers.wallet} IS NOT NULL`))
    .returning({ wallet: telegramUsers.wallet });
  return row ? "unlinked" : null;
}

// ── updates (each handled once) ──────────────────────────────────────────────────────────────────────────────────────
export async function tgClaimUpdate(db: Db, updateId: number, now: number): Promise<boolean> {
  const rows = await db.insert(telegramUpdates).values({ updateId, receivedAt: now }).onConflictDoNothing().returning({ id: telegramUpdates.updateId });
  return rows.length > 0;
}

// ── outbox ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export type OutMessage = { chatId: string; method: "sendMessage" | "sendPhoto"; payload: Record<string, unknown>; dedupeKey?: string };

/** Queues a message. With a dedupe key, the same event is queued once however many times it is seen. Returns the id, or null if a duplicate. */
export async function tgEnqueue(db: Db, m: OutMessage, now: number): Promise<number | null> {
  const rows = await db
    .insert(telegramOutbox)
    .values({ dedupeKey: m.dedupeKey ?? null, chatId: m.chatId, method: m.method, payload: m.payload, nextAttemptAt: now, createdAt: now })
    .onConflictDoNothing()
    .returning({ id: telegramOutbox.id });
  return rows[0]?.id ?? null;
}

export async function tgDueOutbox(db: Db, now: number, limit: number): Promise<OutboxRow[]> {
  return db.select().from(telegramOutbox).where(and(eq(telegramOutbox.status, "pending"), lte(telegramOutbox.nextAttemptAt, now))).orderBy(asc(telegramOutbox.id)).limit(limit);
}

export async function tgMarkSent(db: Db, id: number, now: number): Promise<void> {
  await db.update(telegramOutbox).set({ status: "sent", sentAt: now, lastError: null }).where(eq(telegramOutbox.id, id));
}

export async function tgMarkRetry(db: Db, id: number, attempts: number, nextAttemptAt: number, error: string): Promise<void> {
  await db.update(telegramOutbox).set({ attempts, nextAttemptAt, lastError: error.slice(0, 300) }).where(eq(telegramOutbox.id, id));
}

export async function tgMarkFailed(db: Db, id: number, attempts: number, error: string): Promise<void> {
  await db.update(telegramOutbox).set({ status: "failed", attempts, lastError: error.slice(0, 300) }).where(eq(telegramOutbox.id, id));
}

/** How many messages went to this chat since `since` — Telegram's per-chat limits are checked against the database, not memory. */
export async function tgSentSince(db: Db, chatId: string, since: number): Promise<number> {
  const [r] = await db.select({ n: count() }).from(telegramOutbox).where(and(eq(telegramOutbox.chatId, chatId), eq(telegramOutbox.status, "sent"), gt(telegramOutbox.sentAt, since)));
  return Number(r?.n ?? 0);
}

export async function tgOutboxCounts(db: Db): Promise<{ pending: number; failed: number; sent24h: number }> {
  const since = Date.now() - 24 * 3600_000;
  const rows = await db.select({ status: telegramOutbox.status, n: count() }).from(telegramOutbox).groupBy(telegramOutbox.status);
  const [sent] = await db.select({ n: count() }).from(telegramOutbox).where(and(eq(telegramOutbox.status, "sent"), gt(telegramOutbox.sentAt, since)));
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { pending: by.pending ?? 0, failed: by.failed ?? 0, sent24h: Number(sent?.n ?? 0) };
}

// ── state (cursors of the automatic posts) ───────────────────────────────────────────────────────────────────────────
export async function tgGetState<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(telegramState).where(eq(telegramState.key, key));
  return (row?.value as T) ?? null;
}

export async function tgSetState(db: Db, key: string, value: unknown, now: number): Promise<void> {
  await db.insert(telegramState).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: telegramState.key, set: { value, updatedAt: now } });
}

// ── watchlist ────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function tgWatch(db: Db, telegramId: number, mint: string, now: number): Promise<boolean> {
  const rows = await db.insert(telegramWatchlist).values({ telegramId, mint, createdAt: now }).onConflictDoNothing().returning({ mint: telegramWatchlist.mint });
  return rows.length > 0;
}

export async function tgUnwatch(db: Db, telegramId: number, mint: string): Promise<boolean> {
  const rows = await db.delete(telegramWatchlist).where(and(eq(telegramWatchlist.telegramId, telegramId), eq(telegramWatchlist.mint, mint))).returning({ mint: telegramWatchlist.mint });
  return rows.length > 0;
}

export async function tgWatchlist(db: Db, telegramId: number): Promise<string[]> {
  const rows = await db.select({ mint: telegramWatchlist.mint }).from(telegramWatchlist).where(eq(telegramWatchlist.telegramId, telegramId)).orderBy(asc(telegramWatchlist.createdAt));
  return rows.map((r) => r.mint);
}

// ── alerts ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function tgAddAlert(db: Db, a: { telegramId: number; mint: string; ticker: string; metric: "price" | "mcap"; direction: "above" | "below"; value: number }, now: number): Promise<AlertRow> {
  const [row] = await db.insert(telegramAlerts).values({ ...a, createdAt: now }).returning();
  return row;
}

/** A user's alerts that haven't fired yet, oldest first (the order /alerts numbers them in). */
export async function tgUserAlerts(db: Db, telegramId: number): Promise<AlertRow[]> {
  return db.select().from(telegramAlerts).where(and(eq(telegramAlerts.telegramId, telegramId), isNull(telegramAlerts.firedAt))).orderBy(asc(telegramAlerts.createdAt));
}

export async function tgDeleteAlert(db: Db, telegramId: number, id: string): Promise<boolean> {
  const rows = await db.delete(telegramAlerts).where(and(eq(telegramAlerts.id, id), eq(telegramAlerts.telegramId, telegramId))).returning({ id: telegramAlerts.id });
  return rows.length > 0;
}

/** Every alert still waiting to fire, for users who haven't blocked the bot. */
export async function tgLiveAlerts(db: Db, limit = 5000): Promise<(AlertRow & { lang: string })[]> {
  const rows = await db
    .select({ a: telegramAlerts, lang: telegramUsers.lang })
    .from(telegramAlerts)
    .innerJoin(telegramUsers, eq(telegramUsers.telegramId, telegramAlerts.telegramId))
    .where(and(isNull(telegramAlerts.firedAt), eq(telegramUsers.blocked, false)))
    .limit(limit);
  return rows.map((r) => ({ ...r.a, lang: r.lang }));
}

/** Marks an alert fired. True only for the ONE caller that did it — an alert can never fire twice. */
export async function tgFireAlert(db: Db, id: string, now: number): Promise<boolean> {
  const rows = await db.update(telegramAlerts).set({ firedAt: now }).where(and(eq(telegramAlerts.id, id), isNull(telegramAlerts.firedAt))).returning({ id: telegramAlerts.id });
  return rows.length > 0;
}

// ── suggestions ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function tgAddSuggestion(db: Db, telegramId: number, text: string, now: number): Promise<void> {
  await db.insert(telegramSuggestions).values({ telegramId, text, createdAt: now });
}

export async function tgSuggestionsSince(db: Db, telegramId: number, since: number): Promise<number> {
  const [r] = await db.select({ n: count() }).from(telegramSuggestions).where(and(eq(telegramSuggestions.telegramId, telegramId), gt(telegramSuggestions.createdAt, since)));
  return Number(r?.n ?? 0);
}

export async function tgListSuggestions(db: Db, limit = 50): Promise<{ id: string; telegramId: number; text: string; createdAt: number }[]> {
  return db.select().from(telegramSuggestions).orderBy(desc(telegramSuggestions.createdAt)).limit(limit);
}

// ── wallet linking ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function tgInsertLinkCode(db: Db, codeHash: string, telegramId: number, now: number, expiresAt: number): Promise<void> {
  await db.insert(telegramLinkCodes).values({ codeHash, telegramId, createdAt: now, expiresAt });
}

export async function tgGetLinkCode(db: Db, codeHash: string): Promise<typeof telegramLinkCodes.$inferSelect | null> {
  const [row] = await db.select().from(telegramLinkCodes).where(eq(telegramLinkCodes.codeHash, codeHash));
  return row ?? null;
}

export type LinkOutcome = { ok: true; previousTelegramId: number | null } | { ok: false; reason: "code_used_or_expired" | "linked_elsewhere" };

/**
 * Burns the code and links the wallet, in ONE transaction: the code is consumed only if it is still unused, unexpired and
 * bound to `telegramId` (so it can never link another account or link twice). If the wallet is linked to a DIFFERENT
 * Telegram account, nothing changes unless `replace` (the user signed a message saying so) — then that account loses it and
 * its id is returned so it can be told.
 */
export async function tgLinkWallet(db: Db, i: { codeHash: string; telegramId: number; wallet: string; replace: boolean; now: number }): Promise<LinkOutcome> {
  return db.transaction(async (tx) => {
    // The code first: an invalid one learns nothing about the wallet. (The burn below re-checks it, so a race can't pass.)
    const [code] = await tx.select().from(telegramLinkCodes).where(eq(telegramLinkCodes.codeHash, i.codeHash));
    if (!code || code.telegramId !== i.telegramId || code.usedAt !== null || code.expiresAt <= i.now) return { ok: false as const, reason: "code_used_or_expired" as const };
    const [holder] = await tx.select({ telegramId: telegramUsers.telegramId }).from(telegramUsers).where(and(eq(telegramUsers.wallet, i.wallet), ne(telegramUsers.telegramId, i.telegramId)));
    if (holder && !i.replace) return { ok: false as const, reason: "linked_elsewhere" as const };
    const burned = await tx
      .update(telegramLinkCodes)
      .set({ usedAt: i.now, usedByWallet: i.wallet })
      .where(and(eq(telegramLinkCodes.codeHash, i.codeHash), eq(telegramLinkCodes.telegramId, i.telegramId), isNull(telegramLinkCodes.usedAt), gt(telegramLinkCodes.expiresAt, i.now)))
      .returning({ h: telegramLinkCodes.codeHash });
    if (burned.length === 0) return { ok: false as const, reason: "code_used_or_expired" as const };
    if (holder) await tx.update(telegramUsers).set({ wallet: null, linkedAt: null, updatedAt: i.now }).where(eq(telegramUsers.telegramId, holder.telegramId));
    await tx
      .insert(telegramUsers)
      .values({ telegramId: i.telegramId, wallet: i.wallet, linkedAt: i.now, createdAt: i.now, updatedAt: i.now })
      .onConflictDoUpdate({ target: telegramUsers.telegramId, set: { wallet: i.wallet, linkedAt: i.now, updatedAt: i.now } });
    return { ok: true as const, previousTelegramId: holder?.telegramId ?? null };
  });
}

export async function tgWalletHolder(db: Db, wallet: string): Promise<number | null> {
  const [row] = await db.select({ telegramId: telegramUsers.telegramId }).from(telegramUsers).where(eq(telegramUsers.wallet, wallet));
  return row?.telegramId ?? null;
}

// ── stats & cleanup ──────────────────────────────────────────────────────────────────────────────────────────────────
/** `updates1h`: how many updates Telegram delivered in the last hour — ids only, never content (it's how the privacy-mode test
 *  in docs/TELEGRAM.md §6 checks what the bot receives from the group). */
export async function tgStats(db: Db, now: number = Date.now()): Promise<{ users: number; linked: number; alerts: number; watched: number; suggestions: number; updates1h: number }> {
  const one = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const [users, linked, alerts, watched, suggestions, updates1h] = await Promise.all([
    one(db.select({ n: count() }).from(telegramUsers)),
    one(db.select({ n: count() }).from(telegramUsers).where(sql`${telegramUsers.wallet} IS NOT NULL`)),
    one(db.select({ n: count() }).from(telegramAlerts).where(isNull(telegramAlerts.firedAt))),
    one(db.select({ n: count() }).from(telegramWatchlist)),
    one(db.select({ n: count() }).from(telegramSuggestions)),
    one(db.select({ n: count() }).from(telegramUpdates).where(gt(telegramUpdates.receivedAt, now - 3_600_000))),
  ]);
  return { users, linked, alerts, watched, suggestions, updates1h };
}

/** Old bookkeeping only: processed update ids (2 days), link codes (1 day after expiry), sent/failed messages (14 days), fired alerts (30 days). */
export async function tgCleanup(db: Db, now: number): Promise<void> {
  await db.delete(telegramUpdates).where(lt(telegramUpdates.receivedAt, now - 2 * 86_400_000));
  await db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, now - 86_400_000));
  await db.delete(telegramOutbox).where(and(inArray(telegramOutbox.status, ["sent", "failed"]), lt(telegramOutbox.createdAt, now - 14 * 86_400_000)));
  await db.delete(telegramAlerts).where(lt(telegramAlerts.firedAt, now - 30 * 86_400_000));
}

// ── reads for the automatic posts (other domains' tables, read-only) ─────────────────────────────────────────────────
/** Coins launched through PANDA after `since` (ms), oldest first — panda_launches is written only after the launch is verified on-chain. */
export async function tgLaunchesSince(db: Db, since: number, limit: number): Promise<{ mint: string; creator: string; launchedAt: number }[]> {
  return db.select().from(pandaLaunches).where(gt(pandaLaunches.launchedAt, since)).orderBy(asc(pandaLaunches.launchedAt)).limit(limit);
}

export async function tgLatestLaunches(db: Db, limit: number): Promise<{ mint: string; creator: string; launchedAt: number }[]> {
  return db.select().from(pandaLaunches).orderBy(desc(pandaLaunches.launchedAt)).limit(limit);
}

export async function tgLastLaunchAt(db: Db): Promise<number> {
  const [r] = await db.select({ t: max(pandaLaunches.launchedAt) }).from(pandaLaunches);
  return Number(r?.t ?? 0);
}

/** Holder payout rounds that really paid someone (status done, verified on-chain by the payout cron), finished at or after `since`. */
export async function tgPayoutRunsSince(db: Db, since: number): Promise<{ mint: string; holdersPaid: number; lamportsPaid: number }[]> {
  return db
    .select({ mint: holderPayoutRuns.mint, holdersPaid: holderPayoutRuns.holdersPaid, lamportsPaid: holderPayoutRuns.lamportsPaid })
    .from(holderPayoutRuns)
    .where(and(eq(holderPayoutRuns.status, "done"), gt(holderPayoutRuns.holdersPaid, 0), gte(holderPayoutRuns.finishedAt, new Date(since))));
}
