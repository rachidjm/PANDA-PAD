import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PANDA_TREASURY } from "./constants";

/**
 * PANDA's fee is a plain SOL transfer to the treasury inside the same transaction as the trade. A system account that
 * would end up holding less than the rent-exempt minimum (890,880 lamports ≈ 0.00089 SOL) makes the WHOLE transaction fail
 * ("InsufficientFundsForRent"). That happens when the treasury wallet has never been funded and a small trade's fee is
 * below that minimum: every small trade would fail, for everyone, until someone sends the treasury a little SOL. So the
 * fee is only added when the treasury can actually receive it; otherwise the trade goes through without it (the
 * readiness check at /api/health/trading tells the owner to fund the treasury).
 */

export const MIN_SYSTEM_ACCOUNT_LAMPORTS = 890_880;

/** Can a transfer of `feeLamports` land in an account that holds `treasuryLamports` right now? */
export function feeIsReceivable(feeLamports: number | bigint, treasuryLamports: number): boolean {
  const fee = Number(feeLamports);
  return fee > 0 && treasuryLamports + fee >= MIN_SYSTEM_ACCOUNT_LAMPORTS;
}

let cached: { at: number; lamports: number } | null = null;

export async function treasuryLamports(connection: Connection, now: number = Date.now()): Promise<number> {
  if (cached && now - cached.at < 30_000) return cached.lamports;
  const lamports = await connection.getBalance(PANDA_TREASURY, "confirmed");
  cached = { at: now, lamports };
  return lamports;
}

/** The fee transfer, or null when it would make the trade fail (see above) or there is nothing to charge. */
export async function feeTransferInstruction(connection: Connection, from: PublicKey, feeLamports: number | bigint): Promise<TransactionInstruction | null> {
  if (!(Number(feeLamports) > 0)) return null;
  let held: number;
  try {
    held = await treasuryLamports(connection);
  } catch {
    // Can't tell (RPC hiccup): assume the treasury is funded, which is the normal state.
    held = MIN_SYSTEM_ACCOUNT_LAMPORTS;
  }
  if (!feeIsReceivable(feeLamports, held)) return null;
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: PANDA_TREASURY, lamports: BigInt(feeLamports.toString()) });
}
