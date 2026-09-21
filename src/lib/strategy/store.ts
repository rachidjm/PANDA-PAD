import { docRead, docUpdate } from "@/lib/storage/store";
import type { RecordState, StrategyDoc, StrategyRecord } from "./types";

/**
 * One document per wallet (`strategies/<wallet>.json`). Every transition is an atomic read-modify-write
 * (ETag-guarded in production), and each one states what it expects to find: that is what makes "BUY
 * can't run twice" and "an order can't be created twice" hold even if two requests race.
 *
 * Holds no secrets: never the Jupiter session token, never a signed transaction. Blob paths in this project
 * are public URLs, so only what is already public on-chain or is the user's own drawing goes in.
 */

const MAX_PER_WALLET = 60;
const MAX_PENDING = 10;
/** A deposit that was prepared but never submitted is discarded after this long. */
export const PREPARED_TTL_MS = 15 * 60_000;

const path = (wallet: string) => `strategies/${wallet}.json`;
const EMPTY: StrategyDoc = { strategies: [] };

export async function listStrategies(wallet: string, now: number): Promise<StrategyRecord[]> {
  const doc = await docRead<StrategyDoc>(path(wallet), EMPTY);
  return doc.strategies.filter((s) => !(s.state === "prepared" && now - s.createdAt > PREPARED_TTL_MS));
}

export type PutResult = { ok: true; record: StrategyRecord } | { ok: false; reason: "exists" | "limit" | "pending_limit"; record?: StrategyRecord };

/** Adds a prepared strategy. The same id twice is refused, not duplicated. */
export async function putPrepared(record: StrategyRecord, now: number): Promise<PutResult> {
  return docUpdate<StrategyDoc, PutResult>(path(record.wallet), EMPTY, (doc) => {
    const strategies = doc.strategies.filter((s) => !(s.state === "prepared" && now - s.createdAt > PREPARED_TTL_MS));
    const existing = strategies.find((s) => s.id === record.id);
    // Asking again before submitting (e.g. the wallet popup was closed) re-prepares; anything already submitted is final.
    if (existing?.state === "prepared") {
      return { next: { strategies: strategies.map((s) => (s.id === record.id ? record : s)) }, result: { ok: true, record } };
    }
    if (existing) return { next: { strategies }, result: { ok: false, reason: "exists", record: existing } };
    if (strategies.length >= MAX_PER_WALLET) return { next: { strategies }, result: { ok: false, reason: "limit" } };
    if (strategies.filter((s) => s.state === "prepared" || s.state === "creating").length >= MAX_PENDING) {
      return { next: { strategies }, result: { ok: false, reason: "pending_limit" } };
    }
    strategies.push(record);
    return { next: { strategies }, result: { ok: true, record } };
  });
}

export type Patch = Partial<Omit<StrategyRecord, "id" | "wallet">>;

/** Applies `patch` only if the record is currently in one of the `from` states. Returns the updated record, or null if not. */
export async function transition(wallet: string, id: string, from: readonly RecordState[], patch: Patch, now: number): Promise<StrategyRecord | null> {
  return docUpdate<StrategyDoc, StrategyRecord | null>(path(wallet), EMPTY, (doc) => {
    const i = doc.strategies.findIndex((s) => s.id === id);
    if (i < 0 || !from.includes(doc.strategies[i].state)) return { next: doc, result: null };
    const updated = { ...doc.strategies[i], ...patch, updatedAt: now };
    const strategies = [...doc.strategies];
    strategies[i] = updated;
    return { next: { strategies }, result: updated };
  });
}
