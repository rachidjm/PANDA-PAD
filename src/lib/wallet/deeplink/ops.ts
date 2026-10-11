import type { DeepLinkProvider } from "./protocol";

/**
 * A wallet request that is on its way, written down so it can be FINISHED by another copy of the Mini App.
 *
 * Coming back from the wallet app, Telegram often opens the Mini App again from scratch instead of returning to the
 * copy that asked. That copy held, in its memory, what to do with the wallet's answer; the new one knows nothing. So
 * the request leaves a note on the phone before the wallet opens: which answer to wait for (its relay slot), which
 * screen it came from, and — when the website's own code says so (noteContinuation) — the calls that complete the
 * operation once the answer is in. The note holds no key and no signature; it is useless without the wallet's answer,
 * and it is forgotten after a few minutes.
 *
 * No wallet library is imported here: the Mini App's first screen reads this file.
 */

export type OpMethod = "connect" | "signAndSendTransaction" | "signTransaction" | "signAllTransactions" | "signMessage";

/**
 * One call that completes an operation after the wallet answered. `put` says where the answer goes in the body:
 * "signature" — the sent transaction's signature; "orders" — the signed transactions, one per id, as the orders route
 * takes them. `confirmed`: only after the chain has confirmed that signature.
 */
export type OpStep = { url: string; body: Record<string, unknown>; put?: "signature" | "orders"; ids?: string[]; confirmed?: boolean };
export type PendingOp = { relayId: string; provider: DeepLinkProvider; method: OpMethod; path: string; at: number; then: OpStep[]; settled?: { ok: boolean; signature?: string } };

const KEY = "panda.tg.op";
export const OP_MAX_AGE_MS = 10 * 60_000;

let noted: OpStep[] | null = null;
/**
 * Called by the website's own code right before it asks the wallet for something: what completes the operation if the
 * page is not there to do it itself. Outside the Mini App nobody reads it and nothing changes.
 */
export function noteContinuation(steps: OpStep[]): void {
  noted = steps;
}
/** The steps noted for the request being made now (read once: they never attach to a later request). */
export function takeContinuation(): OpStep[] {
  const steps = noted ?? [];
  noted = null;
  return steps;
}

export function saveOp(op: PendingOp): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(op));
  } catch {}
}

export function readOp(now: number = Date.now()): PendingOp | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<PendingOp> | null;
    if (!v || typeof v.relayId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(v.relayId) || typeof v.at !== "number" || typeof v.path !== "string" || !v.path.startsWith("/tg") || !Array.isArray(v.then)) return null;
    if (now - v.at > OP_MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return v as PendingOp;
  } catch {
    return null;
  }
}

/** The copy of the app that got the answer says how it ended, so another copy shows the result instead of doing it again. */
export function settleOp(relayId: string, settled: { ok: boolean; signature?: string }): void {
  const op = readOp();
  if (op?.relayId === relayId) saveOp({ ...op, settled });
}

export function clearOp(relayId?: string): void {
  try {
    if (!relayId || readOp()?.relayId === relayId) localStorage.removeItem(KEY);
  } catch {}
}

/** "r_<slot>": the one-time code the wallet's way back to Telegram carries (t.me/<bot>?startapp=r_<slot>). */
export const relayOfStartParam = (v: string | undefined | null) => /^r_([A-Za-z0-9_-]{32})$/.exec(v ?? "")?.[1] ?? null;
