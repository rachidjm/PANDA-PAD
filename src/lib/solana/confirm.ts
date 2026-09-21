import type { Connection } from "@solana/web3.js";
import { classifyFailure, TxFailedError } from "./tx-errors";

/**
 * Waits for a sent transaction by polling its status over plain HTTP.
 * web3.js's own confirmTransaction listens on a WebSocket, which PANDA's RPC
 * proxy (/api/rpc) doesn't carry — without this it would hang until the
 * blockhash expired. Resolves once the transaction is confirmed; throws if it
 * failed on-chain, or if it still isn't confirmed after `timeoutMs` (in which
 * case it may yet land — callers tell the user to check their wallet).
 */
export async function confirmSignature(connection: Connection, signature: string, timeoutMs = 75_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = value[0];
      if (status) {
        if (status.err) throw new TxFailedError(classifyFailure(status.err, await failureLogs(connection, signature)), status.err);
        if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return;
      }
    } catch (err) {
      // A definite on-chain failure ends the wait; a flaky RPC read just retries.
      if (err instanceof TxFailedError || (err instanceof Error && /failed on-chain/.test(err.message))) throw err;
    }
    if (Date.now() > deadline) throw new Error("Transaction failed to confirm in time.");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** The program log lines of a failed transaction, best effort (an RPC that can't return them just yields none, and the reason stays "unknown"). */
async function failureLogs(connection: Connection, signature: string): Promise<string[]> {
  try {
    const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    return tx?.meta?.logMessages ?? [];
  } catch {
    return [];
  }
}
