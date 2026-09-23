import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { activityEvents, economyDaily, economyTotal } from "./schema";
import { METRIC_KEYS, cleanDelta, emptyMetrics, type DayDoc, type Metrics, type MetricKey, type RollupDelta, type TotalDoc } from "@/lib/economy/rollup";
import type { StoredEvent } from "@/lib/activity/types";

/**
 * The activity journal and the economy totals in Postgres. The point of moving them: recording an event and adding its
 * numbers to the day and all-time totals is ONE transaction (in Blob they were separate writes, and a crash between them undercounted).
 * Totals are added only if the event row is new, so recording the same transaction twice can't count it twice.
 */

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type AppendResult = "added" | "duplicate" | "invalid" | "full";

/** DB column name per metric key (the schema's property names are the metric keys themselves). */
const col = (t: typeof economyDaily | typeof economyTotal, k: MetricKey) => t[k];

const eventRow = (e: StoredEvent, now: number) => ({
  id: e.id,
  kind: e.kind,
  ts: e.ts,
  mint: e.mint,
  wallet: e.wallet ?? null,
  lamports: e.lamports ?? null,
  tokenAmount: e.tokenAmount ?? null,
  signature: e.signature ?? null,
  verified: e.verified === true,
  recordedDay: dayOf(now),
});

/**
 * Records an already-sanitized event and, when it is NEW, adds `metrics` to the totals of the event's day and to the all-time
 * row — all or nothing. If the write day is already at `dayCap` events the event is not stored and `dropped` is counted instead
 * (the cap is soft under concurrency: a few simultaneous writers may overshoot it by a handful of rows).
 */
export async function pgRecordActivity(db: Db, event: StoredEvent, metrics: RollupDelta | undefined, now: number, dayCap: number): Promise<AppendResult> {
  const clean = metrics ? cleanDelta(metrics) : undefined;
  if (metrics && !clean) throw new Error("Refusing malformed metrics.");
  return db.transaction(async (tx) => {
    const [seen] = await tx.select({ id: activityEvents.id }).from(activityEvents).where(eq(activityEvents.id, event.id));
    if (seen) return "duplicate";
    const [{ n }] = await tx.select({ n: count() }).from(activityEvents).where(eq(activityEvents.recordedDay, dayOf(now)));
    if (n >= dayCap) {
      // Over the cap the event can't be told apart from a repeat later, so it is not stored and the day is marked as a lower bound.
      await addMetricsTx(tx as unknown as Db, event.ts, { dropped: 1 });
      return "full";
    }
    const inserted = await tx.insert(activityEvents).values(eventRow(event, now)).onConflictDoNothing().returning({ id: activityEvents.id });
    if (inserted.length === 0) return "duplicate"; // a concurrent writer recorded it first
    if (clean) await addMetricsTx(tx as unknown as Db, event.ts, clean);
    return "added";
  });
}

/** Adds a delta to the day of `ts` and to the all-time totals, inside whatever transaction `db` is. */
async function addMetricsTx(db: Db, ts: number, delta: RollupDelta): Promise<void> {
  const day = dayOf(ts);
  const add = (t: typeof economyDaily | typeof economyTotal) => Object.fromEntries(METRIC_KEYS.map((k) => [k, sql`${col(t, k)} + ${delta[k] ?? 0}`]));
  const zero = Object.fromEntries(METRIC_KEYS.map((k) => [k, delta[k] ?? 0]));
  const [d] = await db.insert(economyDaily).values({ day, ...zero }).onConflictDoUpdate({ target: economyDaily.day, set: add(economyDaily) }).returning();
  const [t] = await db
    .insert(economyTotal)
    .values({ id: 1, since: ts, ...zero })
    .onConflictDoUpdate({ target: economyTotal.id, set: { ...add(economyTotal), since: sql`least(${economyTotal.since}, ${ts})` } })
    .returning();
  // The app's numbers are JS numbers: a total past 2^53 would be read back wrong. Refuse (and roll the transaction back) instead.
  for (const row of [d, t]) for (const k of METRIC_KEYS) if (!Number.isSafeInteger(row[k])) throw new RangeError(`Metric ${k} would overflow.`);
}

/** Adds metrics without an event (the "dropped" counter, direct additions). Returns false for a malformed delta. */
export async function pgAddMetrics(db: Db, ts: number, delta: RollupDelta): Promise<boolean> {
  const clean = cleanDelta(delta);
  if (!clean || !Number.isSafeInteger(ts) || ts <= 0) return false;
  await db.transaction(async (tx) => addMetricsTx(tx as unknown as Db, ts, clean));
  return true;
}

/** Events from the last `days` UTC write-days (including today), unordered — the same window the daily Blob documents gave. */
export async function pgReadJournal(db: Db, now: number, days: number): Promise<StoredEvent[]> {
  const since = dayOf(now - (days - 1) * 24 * 3_600_000);
  const rows = await db.select().from(activityEvents).where(gte(activityEvents.recordedDay, since));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as StoredEvent["kind"],
    ts: r.ts,
    mint: r.mint,
    ...(r.wallet ? { wallet: r.wallet } : {}),
    ...(r.lamports !== null ? { lamports: r.lamports } : {}),
    ...(r.tokenAmount !== null ? { tokenAmount: r.tokenAmount } : {}),
    ...(r.signature ? { signature: r.signature } : {}),
    ...(r.verified ? { verified: true } : {}),
  }));
}

const metricsOf = (row: Record<string, unknown> | undefined): Metrics => {
  const m = emptyMetrics();
  if (row) for (const k of METRIC_KEYS) m[k] = Number(row[k] ?? 0);
  return m;
};

export async function pgReadTotal(db: Db): Promise<TotalDoc> {
  const [row] = await db.select().from(economyTotal).where(eq(economyTotal.id, 1));
  return { version: 1, since: row?.since ?? null, metrics: metricsOf(row) };
}

/** The last `days` days (oldest first, today last), zero-filled for days with nothing recorded. */
export async function pgReadDays(db: Db, now: number, days: number): Promise<DayDoc[]> {
  const list = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * 24 * 3_600_000));
  const rows = await db.select().from(economyDaily).where(inArray(economyDaily.day, list));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return list.map((day) => ({ version: 1 as const, day, metrics: metricsOf(byDay.get(day)) }));
}

/** For backfill/compare: the ids in the journal window and how many rows there are. */
export async function pgJournalIds(db: Db, sinceDay: string): Promise<string[]> {
  return (await db.select({ id: activityEvents.id }).from(activityEvents).where(and(gte(activityEvents.recordedDay, sinceDay)))).map((r) => r.id);
}
