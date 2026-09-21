/**
 * Why did a confirmed transaction fail? A failed transaction only says "InstructionError [2, Custom 3012]"; the
 * programs' own log lines say what actually happened. This turns those into a small set of reasons the UI can
 * explain in plain words, instead of the useless "the transaction failed".
 */

export type FailureReason =
  /** Not enough SOL: for the amount, the fee, or the rent of a new token account. */
  | "insufficient_sol"
  /** Not enough of the token being sold. */
  | "insufficient_tokens"
  /** The price moved past the tolerance between quoting and landing. */
  | "slippage"
  /** An account the program expected doesn't exist (for example a pool that isn't set up for this trade). */
  | "account_missing"
  /** The transaction waited too long and its blockhash expired. */
  | "expired"
  | "unknown";

export function classifyFailure(err: unknown, logs?: readonly string[] | null): FailureReason {
  const text = `${JSON.stringify(err ?? "")}\n${(logs ?? []).join("\n")}`.toLowerCase();

  if (text.includes("blockhashnotfound") || text.includes("blockhash not found")) return "expired";
  // The System program: "Transfer: insufficient lamports 20000000, need 505000000".
  if (text.includes("insufficient lamports") || text.includes("insufficientfundsforfee") || text.includes("insufficientfundsforrent")) return "insufficient_sol";
  // The Token program's own "Error: insufficient funds" is about tokens.
  if (text.includes("error: insufficient funds") || text.includes("insufficient funds")) return "insufficient_tokens";
  if (/exceededslippage|slippage|toomuchsolrequired|toolittlesolreceived|toolittletokens|maxquote|minbase|minquote/.test(text)) return "slippage";
  if (text.includes("accountnotinitialized") || text.includes("accountnotfound")) return "account_missing";
  return "unknown";
}

/** A transaction that landed and failed. `reason` is what the UI explains; the message keeps the old wording so older matchers still work. */
export class TxFailedError extends Error {
  constructor(public readonly reason: FailureReason, public readonly rawError?: unknown) {
    super(`Transaction failed on-chain (${reason}).`);
    this.name = "TxFailedError";
  }
}
