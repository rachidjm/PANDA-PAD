import { POINTS_CONFIG, POINT_TYPES, PointType } from "./config";
import { tradePointsDelta } from "./math";

/**
 * The points ledger's data model and the one pure function that mutates it.
 * Events are append-only and idempotent: each has a deterministic ID derived
 * from the chain event that caused it, so processing the same event twice can
 * never count twice.
 */

export type PointsEvent = {
  /** Deterministic: `<signature>:<instructionIndex>:<type>` for chain events; `correction:<id>` for admin corrections. */
  eventId: string;
  wallet: string;
  type: PointType;
  /** Human-readable origin, e.g. "trade:<mint>". */
  source: string;
  /** When the underlying event happened (chain block time, ms) — not when it was processed. */
  ts: number;
  recordedAt: number;
  /** Integer. Negative only for corrections. */
  points: number;
  epoch: number;
  reason: string;
  /** "held" events are kept but don't count (set by the abuse-review phase). */
  status: "valid" | "held";
  formulaVersion: string;
  /** Trade events only: the counted volume this event added (lamports). */
  volumeLamports?: number;
  correctsEventId?: string;
};

export type WalletEpochDoc = { version: 1; wallet: string; epoch: number; events: PointsEvent[] };

export const emptyWalletDoc = (wallet: string, epoch: number): WalletEpochDoc => ({ version: 1, wallet, epoch, events: [] });

export const chainEventId = (signature: string, instructionIndex: number, type: PointType) =>
  `${signature}:${instructionIndex}:${type}`;

const EVENT_ID = /^[A-Za-z0-9:_.\-]{8,200}$/;

export type AwardInput = {
  eventId: string;
  wallet: string;
  type: PointType;
  source: string;
  ts: number;
  /** Required for every type except "trade" (whose points are computed here from the volume). */
  points?: number;
  /** Required for "trade": the verified volume of this trade, in lamports. */
  volumeLamports?: number;
  epoch: number;
  reason: string;
  correctsEventId?: string;
};

export type AwardOutcome =
  | { outcome: "recorded"; awarded: number; next: WalletEpochDoc; event: PointsEvent }
  | { outcome: "duplicate"; awarded: 0; next: WalletEpochDoc }
  | { outcome: "capped"; awarded: 0; next: WalletEpochDoc }
  | { outcome: "rejected"; awarded: 0; next: WalletEpochDoc; reason: string };

const countedTotal = (doc: WalletEpochDoc, type?: PointType) =>
  doc.events
    .filter((e) => e.status === "valid" && e.type !== "correction" && (type === undefined || e.type === type))
    .reduce((sum, e) => sum + e.points, 0);

const countedTradeVolume = (doc: WalletEpochDoc) =>
  doc.events.filter((e) => e.status === "valid" && e.type === "trade").reduce((sum, e) => sum + (e.volumeLamports ?? 0), 0);

/** Sum of counted points for one wallet in one epoch (corrections included, floored at 0). */
export const walletTotal = (doc: WalletEpochDoc): number =>
  Math.max(0, doc.events.filter((e) => e.status === "valid").reduce((sum, e) => sum + e.points, 0));

/**
 * Applies one award to a wallet's epoch document. Never mutates its input.
 * Order of checks: input sanity → duplicate → per-wallet event limit → caps.
 * A capped award is trimmed to the remaining room (or refused when none is left).
 */
export function applyAward(doc: WalletEpochDoc, input: AwardInput, now: number, cfg = POINTS_CONFIG): AwardOutcome {
  const reject = (reason: string): AwardOutcome => ({ outcome: "rejected", awarded: 0, next: doc, reason });

  if (!POINT_TYPES.includes(input.type)) return reject("unknown_type");
  if (!EVENT_ID.test(input.eventId)) return reject("bad_event_id");
  if (typeof input.wallet !== "string" || input.wallet !== doc.wallet) return reject("wallet_mismatch");
  if (!Number.isSafeInteger(input.epoch) || input.epoch !== doc.epoch) return reject("epoch_mismatch");
  if (!Number.isSafeInteger(input.ts) || input.ts <= 0) return reject("bad_timestamp");
  if (input.type === "trade") {
    if (input.points !== undefined) return reject("bad_points");
    if (!Number.isSafeInteger(input.volumeLamports) || (input.volumeLamports as number) < cfg.trade.minVolumeLamports) {
      return reject("below_minimum_volume");
    }
  } else {
    if (input.volumeLamports !== undefined) return reject("bad_volume");
    if (!Number.isSafeInteger(input.points)) return reject("bad_points");
    if (input.type === "correction") {
      if (input.points === 0 || !input.correctsEventId) return reject("bad_correction");
    } else if ((input.points as number) <= 0) {
      return reject("bad_points");
    }
  }
  if (typeof input.reason !== "string" || input.reason.length > 200) return reject("bad_reason");

  if (doc.events.some((e) => e.eventId === input.eventId)) return { outcome: "duplicate", awarded: 0, next: doc };
  if (doc.events.length >= cfg.caps.maxEventsPerWallet) return reject("event_limit");

  let points: number;
  let volumeLamports: number | undefined;
  if (input.type === "trade") {
    volumeLamports = input.volumeLamports as number;
    points = tradePointsDelta(countedTradeVolume(doc), volumeLamports, cfg.trade);
  } else {
    points = input.points as number;
  }
  if (input.type !== "correction") {
    const roomType = cfg.caps.perWalletPerEpochByType[input.type] - countedTotal(doc, input.type);
    const roomTotal = cfg.caps.perWalletPerEpochTotal - countedTotal(doc);
    const trimmed = Math.min(points, roomType, roomTotal);
    // A trade that earns 0 (fractional progress, or already at the cap) is still recorded so its volume keeps counting,
    // unless the caps have nothing left at all.
    if (input.type !== "trade" && trimmed <= 0) return { outcome: "capped", awarded: 0, next: doc };
    if (input.type === "trade" && Math.min(roomType, roomTotal) <= 0) return { outcome: "capped", awarded: 0, next: doc };
    points = Math.max(0, trimmed);
  }

  const event: PointsEvent = {
    eventId: input.eventId,
    wallet: input.wallet,
    type: input.type,
    source: input.source.slice(0, 120),
    ts: input.ts,
    recordedAt: now,
    points,
    epoch: input.epoch,
    reason: input.reason,
    status: "valid",
    formulaVersion: cfg.version,
    ...(volumeLamports !== undefined ? { volumeLamports } : {}),
    ...(input.correctsEventId ? { correctsEventId: input.correctsEventId } : {}),
  };
  return { outcome: "recorded", awarded: points, next: { ...doc, events: [...doc.events, event] }, event };
}
