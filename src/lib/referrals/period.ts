/**
 * The Recruiters panel's own period filter — pure date math, no timezone guessing: every boundary is UTC
 * midnight, same as the rest of the referrals system (streak days, daily volume) already uses.
 */

export const PERIOD_KEYS = ["today", "yesterday", "7d", "30d", "month", "prevMonth", "all", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export type PeriodInput = { key: PeriodKey; from?: number; to?: number };
export type Range = { from: number; to: number };

const DAY_MS = 86_400_000;

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `null` = no bound at all ("all" / an unrecognized key never silently narrows the data). */
export function periodRange(input: PeriodInput, now: number = Date.now()): Range | null {
  const todayStart = utcMidnight(now);
  switch (input.key) {
    case "today":
      return { from: todayStart, to: now };
    case "yesterday":
      return { from: todayStart - DAY_MS, to: todayStart };
    case "7d":
      return { from: todayStart - 6 * DAY_MS, to: now };
    case "30d":
      return { from: todayStart - 29 * DAY_MS, to: now };
    case "month": {
      const d = new Date(now);
      return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), to: now };
    }
    case "prevMonth": {
      const d = new Date(now);
      return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1), to: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) };
    }
    case "custom":
      if (typeof input.from === "number" && typeof input.to === "number" && input.from <= input.to) return { from: input.from, to: input.to };
      return null;
    case "all":
    default:
      return null;
  }
}

/** The SAME LENGTH window immediately before `range` — what "vs. the previous period" compares against. `null` in, `null` out ("all" has no previous period). */
export function previousPeriodRange(range: Range | null): Range | null {
  if (!range) return null;
  const len = range.to - range.from;
  if (len <= 0) return null;
  return { from: range.from - len, to: range.from };
}

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && (PERIOD_KEYS as readonly string[]).includes(v);
}
