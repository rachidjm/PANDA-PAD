import { Connection, PublicKey } from "@solana/web3.js";
import { feeSharingConfigPda } from "@pump-fun/pump-sdk";
import { getTokenHolders } from "@/lib/solana/holders";
import { computeHolderCredits } from "./split";
import { creditHolders } from "./ledger";
import { ineligibleHolders } from "./eligible";
import { getDb } from "@/lib/db/client";
import { storageMode } from "@/lib/db/mode";
import { pgKnownRewardSignatures } from "@/lib/db/rewards";
import { alertOps } from "@/lib/alerts";

/**
 * Books what the Rewards Pool received from one distribution to the coin's holders — the real ones only (see eligible.ts),
 * in proportion to what each holds right now. Applied once per distribution transaction (the ledger refuses a repeat).
 * With nobody to credit yet (only the bonding curve and the creator hold the coin) nothing is booked: the distribution
 * stays pending and `catchUpDistributions` books it on a later run, once there are holders.
 */
export async function creditDistribution(connection: Connection, mint: string, lamports: number, signature: string): Promise<{ holdersCredited: number }> {
  const all = await getTokenHolders(connection, mint);
  if (all.length === 0) return { holdersCredited: 0 };
  const exclude = await ineligibleHolders(connection, mint, [...new Set(all.map((h) => h.address))]);
  const holders = all.filter((h) => !exclude.has(h.address));
  if (holders.length === 0) return { holdersCredited: 0 };
  // Integer-exact split by raw token balance; the rounding remainder is recorded as dust, never lost.
  const { credits, dust } = computeHolderCredits(holders, lamports);
  if (credits.length === 0) return { holdersCredited: 0 };
  await creditHolders(mint, lamports, credits, dust, signature);
  return { holdersCredited: credits.length };
}

/** The parts of a confirmed transaction this module reads. */
export type TxView = { keys: string[]; pre: number[]; post: number[]; fee: number; failed: boolean; logs: string[] };

/**
 * Is this transaction a creator-fee distribution of ONE registered coin that paid the Rewards Pool — and how much?
 * `configs` maps each registered coin's fee-sharing account to its mint. Null = not one (a payout, a top-up, a failed
 * transaction, nothing received). "ambiguous" = it touches several registered coins, so its amount can't be assigned
 * to one of them: never guessed, left for a person to look at.
 */
export function poolDistribution(tx: TxView, pool: string, configs: ReadonlyMap<string, string>): { mint: string; lamports: number } | "ambiguous" | null {
  if (tx.failed) return null;
  if (!tx.logs.some((l) => l.includes("Instruction: DistributeCreatorFees"))) return null;
  const at = tx.keys.indexOf(pool);
  if (at < 0) return null;
  // The pool's own network fee (when it sent the transaction itself) isn't part of what the distribution paid it.
  const lamports = tx.post[at] - tx.pre[at] + (at === 0 ? tx.fee : 0);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) return null;
  const mints = [...new Set(tx.keys.map((k) => configs.get(k)).filter((m): m is string => !!m))];
  if (mints.length === 0) return null;
  if (mints.length > 1) return "ambiguous";
  return { mint: mints[0], lamports };
}

const RECENT_SIGNATURES = 100;
const MAX_READS_PER_RUN = 5;
/** Transactions already looked at and found not to be a distribution (a top-up, a payout of an older ledger...): not read again while this instance lives. */
const notDistributions = new Set<string>();

export type CaughtUp = { mint: string; signature: string; lamports: number; holdersCredited: number; blockTimeMs: number | null };

/**
 * The safety net behind the cron: every recent distribution that really paid the Rewards Pool and is NOT in the ledger
 * yet gets booked now. That covers a distribution whose holders couldn't be read at the time (the Token-2022 coins that
 * were credited to nobody, an RPC failure right after the transaction confirmed, a coin with no real holders yet) and
 * one the coin's creator triggered by hand from "Mis monedas", which pays the pool without passing through the cron.
 * The chain is the source: the pool's own transactions, minus the ones the ledger already knows. Postgres only (the
 * ledger's once-per-transaction rule lives there).
 */
export async function catchUpDistributions(connection: Connection, pool: PublicKey, mints: readonly string[]): Promise<{ credited: CaughtUp[]; waiting: number }> {
  const out = { credited: [] as CaughtUp[], waiting: 0 };
  if (storageMode("rewards") !== "postgres" || mints.length === 0) return out;
  const recent = (await connection.getSignaturesForAddress(pool, { limit: RECENT_SIGNATURES })).filter((s) => !s.err).map((s) => s.signature);
  const fresh = recent.filter((s) => !notDistributions.has(s));
  if (fresh.length === 0) return out;
  const known = await pgKnownRewardSignatures(getDb(), fresh);
  const unknown = fresh.filter((s) => !known.has(s)).reverse(); // oldest first
  if (unknown.length === 0) return out;
  const configs = new Map(mints.map((m) => [feeSharingConfigPda(new PublicKey(m)).toBase58(), m]));

  for (const signature of unknown.slice(0, MAX_READS_PER_RUN)) {
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx?.meta) continue; // not readable right now: looked at again next run
    const found = poolDistribution(
      { keys: tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()), pre: tx.meta.preBalances, post: tx.meta.postBalances, fee: tx.meta.fee, failed: !!tx.meta.err, logs: tx.meta.logMessages ?? [] },
      pool.toBase58(),
      configs
    );
    if (found === null) {
      notDistributions.add(signature);
      continue;
    }
    if (found === "ambiguous") {
      notDistributions.add(signature);
      await alertOps("A fee distribution touches several registered coins — its Holders share was NOT credited, check it by hand", { signature });
      continue;
    }
    const { holdersCredited } = await creditDistribution(connection, found.mint, found.lamports, signature);
    if (holdersCredited === 0) out.waiting++;
    else out.credited.push({ ...found, signature, holdersCredited, blockTimeMs: tx.blockTime ? tx.blockTime * 1000 : null });
  }
  return out;
}
