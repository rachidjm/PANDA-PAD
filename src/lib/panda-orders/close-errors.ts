/**
 * Cancelling an order or recovering deposits never ends in silence: whatever stopped it — the server, the simulation,
 * the SOL for the fee, the wallet, the network — becomes a code the panel has a plain sentence for. Pure, so every case
 * is tested.
 */

export type CloseFailure = { message: string; code: string; detail?: { needLamports: number; haveLamports: number } };

/** The code for a close / recover the server refused: its own, or a plain one for the answers that carry none. */
export function closeFailureCode(status: number, code: unknown): string {
  if (typeof code === "string" && code) return code;
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 429) return "too_many_requests";
  return "server_error";
}

/** `api`: an error built from the server's own answer (it carries that answer's code). Anything else came from the
 *  browser, the wallet or the network. */
export function closeError(err: unknown): CloseFailure {
  const e = (err && typeof err === "object" ? err : {}) as { api?: unknown; code?: unknown; detail?: CloseFailure["detail"]; message?: unknown; name?: unknown };
  const message = typeof e.message === "string" ? e.message : String(err);
  if (e.api === true) return { message, code: typeof e.code === "string" && e.code ? e.code : "server_error", detail: e.detail };
  const name = typeof e.name === "string" ? e.name : "";
  if (/reject|cancel|denied/i.test(message)) return { message, code: "REJECTED" };
  if (/failed on-chain/.test(message)) return { message: "", code: "close_failed" };
  if (/confirmed in time/.test(message)) return { message: "", code: "close_unconfirmed" };
  if (name === "TimeoutError" || name === "AbortError" || name === "TypeError" || name === "SyntaxError" || /fetch|network/i.test(message)) return { message: "", code: "server_error" };
  return { message, code: "wallet_error" };
}
