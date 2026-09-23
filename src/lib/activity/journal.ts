import { docRead, docUpdate } from "@/lib/storage/store";
import { getDb } from "@/lib/db/client";
import { storageMode } from "@/lib/db/mode";
import { pgReadJournal } from "@/lib/db/activity";
import { ACTIVITY_CONFIG as C } from "./config";
import { FEED_KINDS, StoredEvent } from "./types";

/**
 * The journal: events PANDA itself verified on-chain at the moment they happened (a fee distribution it
 * sent, a reward it paid, a trade it checked, a coin it registered). One document per day, appended
 * atomically and idempotent by event id. Nothing here is written from a client's say-so.
 */

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const ID = /^[A-Za-z0-9:_.\-]{6,140}$/;

type Day = { version: 1; events: StoredEvent[] };
const EMPTY: Day = { version: 1, events: [] };
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pathFor = (ms: number) => `activity/journal/${dayKey(ms)}.json`;

/** Returns the event reduced to storable, validated fields — or null if it isn't a well-formed event. */
export function sanitizeEvent(e: StoredEvent, now: number): StoredEvent | null {
  if (!e || typeof e !== "object") return null;
  if (!ID.test(e.id) || !(FEED_KINDS as readonly string[]).includes(e.kind) || !ADDRESS.test(e.mint)) return null;
  if (!Number.isSafeInteger(e.ts) || e.ts <= 0 || e.ts > now + C.maxFutureMs) return null;
  if (e.wallet !== undefined && !ADDRESS.test(e.wallet)) return null;
  if (e.signature !== undefined && !SIGNATURE.test(e.signature)) return null;
  if (e.lamports !== undefined && !(Number.isSafeInteger(e.lamports) && e.lamports >= 0)) return null;
  if (e.tokenAmount !== undefined && !(Number.isFinite(e.tokenAmount) && e.tokenAmount >= 0)) return null;
  return {
    id: e.id,
    kind: e.kind,
    ts: e.ts,
    mint: e.mint,
    ...(e.wallet ? { wallet: e.wallet } : {}),
    ...(e.lamports !== undefined ? { lamports: e.lamports } : {}),
    ...(e.tokenAmount !== undefined ? { tokenAmount: e.tokenAmount } : {}),
    ...(e.signature ? { signature: e.signature } : {}),
    ...(e.verified ? { verified: true } : {}),
  };
}

export type AppendResult = "added" | "duplicate" | "invalid" | "full";

export async function appendEvent(event: StoredEvent, now: number): Promise<AppendResult> {
  const clean = sanitizeEvent(event, now);
  if (!clean) return "invalid";
  return docUpdate<Day, AppendResult>(pathFor(now), EMPTY, (day) => {
    if (day.events.some((x) => x.id === clean.id)) return { next: day, result: "duplicate" };
    if (day.events.length >= C.journalDayCap) return { next: day, result: "full" };
    return { next: { ...day, events: [...day.events, clean] }, result: "added" };
  });
}

/** Events from the last `C.journalDays` daily documents (by write date), unordered. */
export async function readJournal(now: number): Promise<StoredEvent[]> {
  if (storageMode("activity") === "postgres") return pgReadJournal(getDb(), now, C.journalDays);
  const days = Array.from({ length: C.journalDays }, (_, i) => docRead<Day>(pathFor(now - i * 24 * 3_600_000), EMPTY));
  const out: StoredEvent[] = [];
  for (const d of await Promise.all(days)) for (const e of d.events) out.push(e);
  return out;
}
