import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PANDA_TREASURY } from "./constants";
import { isEnabled } from "@/lib/config/flags";
import { getDb } from "@/lib/db/client";
import { pgGetReferrer } from "@/lib/db/referrals";
import { campaignActive, referralShareBps } from "@/lib/referrals/constants";

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

/**
 * The affiliate campaign (phase: referrals): if `from` was referred, the campaign is currently running, and the
 * referrer's own wallet can actually receive its share without going below the same rent-exempt minimum as
 * above, this is that referrer and their cut of `feeLamports` (basis points of the FEE, not of the trade —
 * REFERRAL_SHARE_BPS). Otherwise null, and the whole fee goes to the treasury as usual. Never throws: any
 * failure along the way (no DB configured, an RPC hiccup reading the referrer's balance, ...) is treated the
 * same as "no referrer" — a referral is a bonus on top of the trade, never a reason the trade could fail or
 * behave differently.
 */
async function referrerShare(connection: Connection, from: PublicKey, feeLamports: number): Promise<{ pubkey: PublicKey; lamports: number } | null> {
  if (!isEnabled("REFERRALS") || !campaignActive()) return null;
  try {
    const referrerAddr = await pgGetReferrer(getDb(), from.toBase58());
    if (!referrerAddr) return null;
    const referrerPubkey = new PublicKey(referrerAddr); // stored addresses are only ever written after PublicKey validation (see bind.ts)
    const share = Math.floor((feeLamports * referralShareBps()) / 10_000);
    if (share <= 0) return null;
    const referrerBalance = await connection.getBalance(referrerPubkey, "confirmed");
    if (!feeIsReceivable(share, referrerBalance)) return null; // "Si la wallet del invitador no tiene el mínimo de renta, esa parte va a la tesorería"
    return { pubkey: referrerPubkey, lamports: share };
  } catch {
    return null;
  }
}

/**
 * The real fee instruction(s) for this trade: one transfer to the treasury, OR — during the affiliate
 * campaign, for a referred trader, when the referrer can receive it — two transfers in the SAME transaction:
 * the referrer's cut straight to their own wallet, the rest to the treasury. PANDA never holds the referral
 * share even for an instant. An empty array when there's nothing to charge or the treasury itself can't
 * receive it (see feeTransferInstruction).
 */
export async function feeTransferInstructions(connection: Connection, from: PublicKey, feeLamports: number | bigint): Promise<TransactionInstruction[]> {
  const fee = Number(feeLamports);
  if (!(fee > 0)) return [];

  const referrer = await referrerShare(connection, from, fee);
  if (!referrer) {
    const ix = await feeTransferInstruction(connection, from, fee);
    return ix ? [ix] : [];
  }

  const instructions = [SystemProgram.transfer({ fromPubkey: from, toPubkey: referrer.pubkey, lamports: BigInt(referrer.lamports) })];
  const treasuryIx = await feeTransferInstruction(connection, from, fee - referrer.lamports);
  if (treasuryIx) instructions.push(treasuryIx);
  return instructions;
}
