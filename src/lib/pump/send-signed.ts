import type { Connection, VersionedTransaction } from "@solana/web3.js";

/** A transaction that would fail was not sent: the simulation said so. */
export class SimulationFailedError extends Error {
  constructor(public readonly detail: string) {
    super(`simulation failed: ${detail}`);
    this.name = "SimulationFailedError";
  }
}

/**
 * Sends a transaction the wallet has ALREADY signed (a launch approved together with its first buy — see first-buy.ts).
 * It is simulated first, signatures checked: one that would fail — or whose signatures don't hold — is never sent and
 * costs nothing. Returns its signature; confirming it is the caller's job.
 */
export async function sendSigned(connection: Pick<Connection, "simulateTransaction" | "sendRawTransaction">, tx: VersionedTransaction): Promise<string> {
  const sim = await connection.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
  if (sim.value.err) throw new SimulationFailedError(typeof sim.value.err === "string" ? sim.value.err : JSON.stringify(sim.value.err));
  return connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
}
