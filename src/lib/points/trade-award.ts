import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { PANDA_FEE_BPS, PANDA_TREASURY } from "@/lib/pump/constants";
import { BPS_TOTAL } from "@/lib/money/bps";
import { chainEventId } from "./events";
import { awardPoints, AwardResult } from "./store";

/**
 * Turns one already-verified trade transaction into trade points. A trade only
 * earns points if it really went through PANDA: the transaction must contain a
 * SystemProgram transfer of PANDA's fee from the trader to the treasury. That
 * fee is real money the trader paid, so the volume counted is the LOWER of what
 * the fee implies (fee / fee-rate) and the trader's observed SOL movement —
 * a fee can't be inflated on paper, and a trade elsewhere earns nothing here.
 *
 * Pure extraction (`findPandaFee`, `countedVolumeLamports`) is separate from the
 * award so it can be tested without a chain.
 */

export function findPandaFee(
  tx: Pick<ParsedTransactionWithMeta, "transaction">,
  wallet: string,
  treasury = PANDA_TREASURY.toBase58()
): { lamports: number; instructionIndex: number } | null {
  let total = 0;
  let firstIndex = -1;
  tx.transaction.message.instructions.forEach((ix, index) => {
    if (!("parsed" in ix) || ix.program !== "system") return;
    const parsed = ix.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
    if (parsed.type !== "transfer" || parsed.info?.source !== wallet || parsed.info?.destination !== treasury) return;
    const lamports = parsed.info.lamports;
    if (!Number.isSafeInteger(lamports) || (lamports as number) <= 0) return;
    total += lamports as number;
    if (firstIndex === -1) firstIndex = index;
  });
  return total > 0 ? { lamports: total, instructionIndex: firstIndex } : null;
}

export function countedVolumeLamports(feeLamports: number, observedSolMovementLamports: number, feeBps = PANDA_FEE_BPS): number {
  if (![feeLamports, observedSolMovementLamports].every((n) => Number.isSafeInteger(n) && n > 0)) return 0;
  const impliedByFee = Math.floor((feeLamports * BPS_TOTAL) / feeBps);
  return Math.min(impliedByFee, observedSolMovementLamports);
}

export async function awardTradePoints(args: {
  tx: ParsedTransactionWithMeta;
  signature: string;
  wallet: string;
  mint: string;
  observedSolMovementLamports: number;
}): Promise<AwardResult> {
  const { tx, signature, wallet, mint, observedSolMovementLamports } = args;
  if (!tx.blockTime) return { outcome: "rejected", awarded: 0, reason: "no_block_time" };
  const fee = findPandaFee(tx, wallet);
  if (!fee) return { outcome: "rejected", awarded: 0, reason: "not_a_panda_trade" };

  return awardPoints({
    eventId: chainEventId(signature, fee.instructionIndex, "trade"),
    wallet,
    type: "trade",
    source: `trade:${mint}`,
    ts: tx.blockTime * 1000,
    volumeLamports: countedVolumeLamports(fee.lamports, observedSolMovementLamports),
    reason: "Trade through PANDA",
  });
}
