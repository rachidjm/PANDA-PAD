import { POINTS_CONFIG, POINTS_FORMULA_VERSION } from "@/lib/points/config";

/**
 * Epochs: the fixed periods points are earned in and rewards are settled for.
 * Pure rules only (transitions, timing, validation); storage is in
 * lib/points/store.ts.
 */

export const EPOCH_STATUSES = [
  "UPCOMING",
  "ACTIVE",
  "SNAPSHOT",
  "CALCULATING",
  "FINALIZED",
  "DISTRIBUTING",
  "COMPLETED",
  "PAUSED",
] as const;
export type EpochStatus = (typeof EPOCH_STATUSES)[number];

export type Epoch = {
  id: number;
  startTime: number;
  /** Points events with a timestamp at or after this no longer belong to the epoch. */
  snapshotTime: number;
  endTime: number;
  /** PANDA base units for the airdrop pool, as a decimal string (may exceed 2^53). */
  rewardPool: string;
  status: EpochStatus;
  /** Set while PAUSED: where to resume to. */
  pausedFrom?: EpochStatus;
  formulaVersion: string;
  createdAt: number;
  /** sha256 of the finalized totals — pins them; set on FINALIZED. */
  totalsHash?: string;
  finalizedAt?: number;
};

const NEXT: Record<EpochStatus, EpochStatus[]> = {
  UPCOMING: ["ACTIVE", "PAUSED"],
  ACTIVE: ["SNAPSHOT", "PAUSED"],
  SNAPSHOT: ["CALCULATING", "PAUSED"],
  CALCULATING: ["FINALIZED", "PAUSED"],
  FINALIZED: ["DISTRIBUTING"], // immutable results: cannot go back, cannot be paused (claims have their own pause switch)
  DISTRIBUTING: ["COMPLETED", "PAUSED"],
  COMPLETED: [],
  PAUSED: [], // resumes only to `pausedFrom`, see canTransition
};

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canTransition(epoch: Epoch, to: EpochStatus, now: number, cfg = POINTS_CONFIG): TransitionCheck {
  const from = epoch.status;
  if (from === "PAUSED") {
    if (to !== epoch.pausedFrom) return { ok: false, reason: `A paused epoch can only resume to ${epoch.pausedFrom}.` };
    return { ok: true };
  }
  if (!NEXT[from].includes(to)) return { ok: false, reason: `Can't move an epoch from ${from} to ${to}.` };
  if (to === "ACTIVE" && now < epoch.startTime) return { ok: false, reason: "The epoch hasn't started yet." };
  if (to === "SNAPSHOT" && now < epoch.snapshotTime + cfg.snapshotGraceMs) {
    return { ok: false, reason: "Too early: wait until the snapshot time plus the grace period." };
  }
  return { ok: true };
}

/** The epoch an event at `ts` belongs to, by time only (status is checked separately), or null. */
export function epochForTime(epochs: Epoch[], ts: number): Epoch | null {
  return epochs.find((e) => ts >= e.startTime && ts < e.snapshotTime) ?? null;
}

/** Whether new points events may currently be recorded into this epoch. */
export const acceptsEvents = (epoch: Epoch) => epoch.status === "ACTIVE";

/** Once results are pinned, nothing about the epoch's points may change. */
export const isImmutable = (epoch: Epoch) => ["FINALIZED", "DISTRIBUTING", "COMPLETED"].includes(epoch.status);

export type NewEpochInput = { startTime: number; snapshotTime: number; endTime: number; rewardPool: string };

const HOUR = 3_600_000;

export function validateNewEpoch(input: NewEpochInput, existing: Epoch[], now: number): string | null {
  const { startTime, snapshotTime, endTime, rewardPool } = input;
  if (![startTime, snapshotTime, endTime].every((n) => Number.isSafeInteger(n) && n > 0)) return "Times must be positive integers (ms).";
  if (!(startTime < snapshotTime && snapshotTime <= endTime)) return "Order must be start < snapshot <= end.";
  if (snapshotTime - startTime < HOUR) return "An epoch must run at least 1 hour.";
  if (endTime - startTime > 90 * 24 * HOUR) return "An epoch can't be longer than 90 days.";
  if (endTime <= now) return "The epoch would already be over.";
  if (typeof rewardPool !== "string" || !/^\d{1,30}$/.test(rewardPool)) return "rewardPool must be a whole number of base units.";
  if (existing.some((e) => startTime < e.endTime && endTime > e.startTime)) return "Overlaps an existing epoch.";
  return null;
}

export function newEpoch(input: NewEpochInput, existing: Epoch[], now: number): Epoch {
  return {
    id: existing.reduce((max, e) => Math.max(max, e.id), 0) + 1,
    ...input,
    status: "UPCOMING",
    formulaVersion: POINTS_FORMULA_VERSION,
    createdAt: now,
  };
}

/** Returns the epoch with its status changed (input untouched). Assumes `canTransition` was checked. */
export function withStatus(epoch: Epoch, to: EpochStatus): Epoch {
  if (to === "PAUSED") return { ...epoch, status: "PAUSED", pausedFrom: epoch.status };
  const { pausedFrom: _drop, ...rest } = epoch;
  void _drop;
  return { ...rest, status: to };
}
