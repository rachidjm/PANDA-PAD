/**
 * The claim lifecycle as pure decisions. Persisted states:
 *
 *   (no record)  = ELIGIBLE
 *   REQUESTED    = claim accepted and reserved; being validated / transaction being built.
 *                  Nothing has been sent, and no signature exists yet.
 *   SENT         = the signed transaction's signature and last-valid block height are
 *                  recorded BEFORE it is submitted; from here on the ONLY authority on
 *                  whether money moved is the chain, never our own bookkeeping.
 *                  (covers the spec's TRANSACTION CREATED / SENT / CONFIRMING)
 *   CLAIMED      = the transaction is FINALIZED on-chain, without error.
 *   FAILED       = the transaction failed on-chain, or its blockhash expired without
 *                  it ever landing — proven not paid, so a retry is safe.
 *
 * Double payment is prevented by two rules: only one caller can win the
 * atomic transition into REQUESTED, and a new attempt is never started while
 * a signature might still land (SENT is only left via chain truth).
 */

export type ClaimStatus = "REQUESTED" | "SENT" | "CLAIMED" | "FAILED";
/** "confirmed" here means FINALIZED. */
export type ChainStatus = "confirmed" | "failed" | "expired" | "pending";

export type ClaimRecord = {
  epoch: number;
  wallet: string;
  /** Base units, decimal string — copied from the verified allocation, never from the client. */
  amount: string;
  status: ClaimStatus;
  attempts: number;
  signature?: string;
  lastValidBlockHeight?: number;
  updatedAt: number;
  history: { status: ClaimStatus; at: number; note?: string }[];
};

/** How long a REQUESTED record (no signature yet) is presumed alive before it may be restarted. */
export const REQUESTED_STALE_MS = 2 * 60_000;
const MAX_HISTORY = 20;

const push = (r: ClaimRecord, status: ClaimStatus, at: number, note?: string): ClaimRecord => ({
  ...r,
  status,
  updatedAt: at,
  history: [...r.history, { status, at, ...(note ? { note } : {}) }].slice(-MAX_HISTORY),
});

export type BeginDecision =
  | { action: "start"; next: ClaimRecord }
  | { action: "already_claimed"; record: ClaimRecord }
  | { action: "in_progress"; record: ClaimRecord }
  | { action: "reconcile"; record: ClaimRecord }
  | { action: "mismatch"; record: ClaimRecord };

export function decideBegin(
  record: ClaimRecord | null,
  args: { epoch: number; wallet: string; amount: string; now: number },
  staleMs = REQUESTED_STALE_MS
): BeginDecision {
  const { epoch, wallet, amount, now } = args;
  if (!record) {
    const fresh: ClaimRecord = { epoch, wallet, amount, status: "REQUESTED", attempts: 1, updatedAt: now, history: [{ status: "REQUESTED", at: now }] };
    return { action: "start", next: fresh };
  }
  if (record.amount !== amount || record.epoch !== epoch || record.wallet !== wallet) return { action: "mismatch", record };

  switch (record.status) {
    case "CLAIMED":
      return { action: "already_claimed", record };
    case "SENT":
      return { action: "reconcile", record };
    case "REQUESTED":
      if (now - record.updatedAt < staleMs) return { action: "in_progress", record };
      // No signature was ever recorded, so nothing was sent: safe to restart.
      return { action: "start", next: { ...push(record, "REQUESTED", now, "restarted after stale request"), attempts: record.attempts + 1 } };
    case "FAILED":
      return { action: "start", next: { ...push(record, "REQUESTED", now, "retry"), attempts: record.attempts + 1 } };
  }
}

/** Moves a SENT record according to what the chain says. Anything other than SENT is returned untouched. */
export function reconcileSent(record: ClaimRecord, chain: ChainStatus, now: number): ClaimRecord {
  if (record.status !== "SENT") return record;
  if (chain === "confirmed") return push(record, "CLAIMED", now, "finalized on-chain");
  if (chain === "failed") return push(record, "FAILED", now, "failed on-chain");
  if (chain === "expired") return push(record, "FAILED", now, "blockhash expired, transaction can no longer land");
  return record;
}

/** Records the signature (BEFORE the transaction is submitted). Only valid for the attempt that owns the reservation. */
export function markSent(record: ClaimRecord | null, attempt: number, signature: string, lastValidBlockHeight: number, now: number): ClaimRecord | null {
  if (!record || record.status !== "REQUESTED" || record.attempts !== attempt) return null;
  return { ...push(record, "SENT", now), signature, lastValidBlockHeight };
}

/** A failure BEFORE anything was signed/sent (e.g. pool too low): proven not paid. */
export function markFailedBeforeSend(record: ClaimRecord | null, attempt: number, now: number, note: string): ClaimRecord | null {
  if (!record || record.status !== "REQUESTED" || record.attempts !== attempt) return null;
  return push(record, "FAILED", now, note);
}
