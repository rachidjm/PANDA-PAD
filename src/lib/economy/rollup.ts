import { docRead, docUpdate } from "@/lib/storage/store";
import { getDb } from "@/lib/db/client";
import { storageMode } from "@/lib/db/mode";
import { pgReadDays, pgReadTotal } from "@/lib/db/activity";

/**
 * Running totals of what PANDA itself measured on-chain, in exact lamports: one document per day plus one
 * all-time document. Only ever ADDED to, and only from places that just verified a transaction (the fee cron,
 * a checked trade). Each metric has its own field — nothing here is a sum of different kinds of money.
 */

export const METRIC_KEYS = [
  /** SOL volume of trades made through PANDA (the wallet's real balance change in a verified transaction). */
  "volumeLamports",
  "trades",
  /** PANDA's 1% trade fee: the real transfer to the treasury found in the verified transaction. */
  "tradeFeeLamports",
  /** All creator fees paid out by verified `distributeCreatorFees` transactions of PANDA-registered coins. */
  "creatorFeeLamports",
  /** Of those, what went to the PANDA treasury (its share of the fee-sharing config)... */
  "creatorFeeTreasuryLamports",
  /** ...and what went to the holders' Rewards Pool. The rest went to creators and partners. */
  "creatorFeePoolLamports",
  "distributions",
  /** Events that could not be counted (the day's journal was full); the day's totals are then a lower bound. */
  "dropped",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number>;
export type RollupDelta = Partial<Metrics>;

export type DayDoc = { version: 1; day: string; metrics: Metrics };
export type TotalDoc = { version: 1; since: number | null; metrics: Metrics };

export const emptyMetrics = (): Metrics => Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Metrics;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayPath = (day: string) => `economy/daily/${day}.json`;
const TOTAL_PATH = "economy/total.json";

/** Validates a delta: only known keys, only non-negative safe integers. Returns null if anything is off. */
export function cleanDelta(d: RollupDelta): RollupDelta | null {
  const out: RollupDelta = {};
  for (const [k, v] of Object.entries(d)) {
    if (!(METRIC_KEYS as readonly string[]).includes(k)) return null;
    if (v === undefined) continue;
    if (!Number.isSafeInteger(v) || v < 0) return null;
    out[k as MetricKey] = v;
  }
  return out;
}

export function addTo(m: Metrics, d: RollupDelta): Metrics {
  const next = { ...m };
  for (const k of METRIC_KEYS) {
    const sum = next[k] + (d[k] ?? 0);
    if (!Number.isSafeInteger(sum)) throw new RangeError(`Metric ${k} would overflow.`);
    next[k] = sum;
  }
  return next;
}

/** Adds a delta to the day of `ts` and to the all-time totals. Refuses malformed deltas. */
export async function addMetrics(ts: number, delta: RollupDelta): Promise<boolean> {
  const clean = cleanDelta(delta);
  if (!clean || !Number.isSafeInteger(ts) || ts <= 0) return false;
  const day = dayOf(ts);
  await docUpdate<DayDoc, void>(dayPath(day), { version: 1, day, metrics: emptyMetrics() }, (doc) => ({
    next: { ...doc, metrics: addTo(doc.metrics, clean) },
    result: undefined,
  }));
  await docUpdate<TotalDoc, void>(TOTAL_PATH, { version: 1, since: null, metrics: emptyMetrics() }, (doc) => ({
    next: { ...doc, since: doc.since === null ? ts : Math.min(doc.since, ts), metrics: addTo(doc.metrics, clean) },
    result: undefined,
  }));
  return true;
}

export async function readTotal(): Promise<TotalDoc> {
  if (storageMode("activity") === "postgres") return pgReadTotal(getDb());
  return docRead<TotalDoc>(TOTAL_PATH, { version: 1, since: null, metrics: emptyMetrics() });
}

/** The last `days` days (oldest first, today last), zero-filled for days with nothing recorded. */
export async function readDays(now: number, days: number): Promise<DayDoc[]> {
  if (storageMode("activity") === "postgres") return pgReadDays(getDb(), now, days);
  const list = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * 24 * 3_600_000));
  return Promise.all(list.map(async (day) => docRead<DayDoc>(dayPath(day), { version: 1, day, metrics: emptyMetrics() })));
}
