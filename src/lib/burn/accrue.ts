import { Connection, PublicKey } from "@solana/web3.js";
import { feeSharingConfigPda } from "@pump-fun/pump-sdk";
import type { Db } from "@/lib/db/client";
import { pgAccrueBurn, pgKnownBurnSignatures } from "@/lib/db/burn";
import type { Share } from "@/lib/economy/shares";
import { poolDistribution } from "@/lib/rewards/credit";

/**
 * Booking what a coin's Burn share paid the burn wallet. The amount is never taken from a percentage: it is what the
 * wallet's balance really changed by in the fee-distribution transaction, and that transaction is booked once.
 */

/** What one distribution paid the burn wallet (0 when the coin has no Burn share). */
export const burnShareOf = (shares: readonly Share[], burnWallet: string): number => shares.find((s) => s.address === burnWallet)?.lamports ?? 0;

/** The collect-fees cron's own distributions: booked right there, from the transaction's balance changes. */
export async function accrueFromDistribution(db: Db, burnWallet: string, d: { mint: string; signature: string; shares: readonly Share[] }): Promise<number> {
  const lamports = burnShareOf(d.shares, burnWallet);
  if (lamports <= 0) return 0;
  return (await pgAccrueBurn(db, { sourceSig: d.signature, mint: d.mint, lamports })) ? lamports : 0;
}

const RECENT_SIGNATURES = 100;
const MAX_READS_PER_RUN = 8;
/** Transactions already looked at and found not to be a distribution (a top-up of the wallet, say): not read again while this instance lives. */
const notDistributions = new Set<string>();

/**
 * The safety net, as for holders' rewards: every recent fee distribution that really paid the burn wallet and isn't in
 * the ledger yet is booked now — one triggered by the coin's creator by hand, or one whose booking failed right after
 * it confirmed. The chain is the source: the burn wallet's own transactions, minus the ones the ledger knows.
 */
export async function catchUpBurnAccruals(connection: Connection, db: Db, burnWallet: PublicKey, mints: readonly string[]): Promise<{ booked: { mint: string; signature: string; lamports: number }[]; ambiguous: string[] }> {
  const out = { booked: [] as { mint: string; signature: string; lamports: number }[], ambiguous: [] as string[] };
  if (mints.length === 0) return out;
  const recent = (await connection.getSignaturesForAddress(burnWallet, { limit: RECENT_SIGNATURES })).filter((s) => !s.err).map((s) => s.signature);
  const fresh = recent.filter((s) => !notDistributions.has(s));
  if (fresh.length === 0) return out;
  const known = await pgKnownBurnSignatures(db, fresh);
  const unknown = fresh.filter((s) => !known.has(s)).reverse(); // oldest first
  const configs = new Map(mints.map((m) => [feeSharingConfigPda(new PublicKey(m)).toBase58(), m]));
  for (const signature of unknown.slice(0, MAX_READS_PER_RUN)) {
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx?.meta) continue; // not readable right now: looked at again next run
    const found = poolDistribution(
      { keys: tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()), pre: tx.meta.preBalances, post: tx.meta.postBalances, fee: tx.meta.fee, failed: !!tx.meta.err, logs: tx.meta.logMessages ?? [] },
      burnWallet.toBase58(),
      configs
    );
    if (found === null) {
      notDistributions.add(signature);
      continue;
    }
    if (found === "ambiguous") {
      // It touches several coins: its amount can't be assigned to one. Never guessed.
      notDistributions.add(signature);
      out.ambiguous.push(signature);
      continue;
    }
    if (await pgAccrueBurn(db, { sourceSig: signature, mint: found.mint, lamports: found.lamports })) out.booked.push({ ...found, signature });
  }
  return out;
}
