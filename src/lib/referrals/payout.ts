import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { isEnabled } from "@/lib/config/flags";
import { DbNotConfiguredError, getDb } from "@/lib/db/client";
import { pgGetReferrer, pgRecordReferralPayout } from "@/lib/db/referrals";

/** Sums every plain SystemProgram transfer FROM `source` TO `destination` in this transaction — same
 *  instruction-scanning approach as src/lib/points/trade-award.ts's findPandaFee, generalized to any pair. */
function findTransferLamports(tx: Pick<ParsedTransactionWithMeta, "transaction">, source: string, destination: string): number {
  let total = 0;
  for (const ix of tx.transaction.message.instructions) {
    if (!("parsed" in ix) || ix.program !== "system") continue;
    const parsed = ix.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
    if (parsed.type !== "transfer" || parsed.info?.source !== source || parsed.info?.destination !== destination) continue;
    const lamports = parsed.info.lamports;
    if (Number.isSafeInteger(lamports) && (lamports as number) > 0) total += lamports as number;
  }
  return total;
}

/**
 * Called after a real trade is confirmed and recorded (see /api/portfolio/record-trade): if `wallet` has a
 * bound referrer AND this exact confirmed transaction really contains a transfer to them (built by
 * src/lib/pump/fee-transfer.ts's referral split, or it wouldn't be there), logs it for the Affiliates page's
 * stats. Purely informational — PANDA never holds this money, it already moved on-chain before this runs — so
 * a failure here never fails the trade record itself.
 */
export async function recordReferralPayoutIfAny(
  tx: Pick<ParsedTransactionWithMeta, "transaction" | "blockTime">,
  wallet: string,
  mint: string,
  signature: string
): Promise<void> {
  if (!isEnabled("REFERRALS")) return;
  try {
    const db = getDb();
    const referrer = await pgGetReferrer(db, wallet);
    if (!referrer) return;
    const lamports = findTransferLamports(tx, wallet, referrer);
    if (lamports <= 0) return;
    await pgRecordReferralPayout(db, { signature, referrer, referred: wallet, mint, lamports, ts: tx.blockTime ? tx.blockTime * 1000 : Date.now() });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return;
    console.error("[PANDA referrals] payout logging failed", signature, err instanceof Error ? err.message : err);
  }
}
