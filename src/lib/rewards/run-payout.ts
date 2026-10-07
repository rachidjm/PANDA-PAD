import { randomUUID } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getLedger, unclaimedLamports, reserveClaim, markClaimSent, confirmClaim, releaseClaim, type Reservation } from "./ledger";
import { batchPayouts, computeEligiblePayouts, shouldRunPayout, type HolderBalance } from "./payout";
import { reserveDailyPayout, releaseDailyPayout, MAX_CLAIM_LAMPORTS, HOLDER_PAYOUT_MIN_LAMPORTS } from "./limits";
import { getRawSharingConfig } from "@/lib/pump/fee-sharing";
import { PANDA_TREASURY, PANDA_REWARDS_POOL } from "@/lib/pump/constants";
import { alertOps } from "@/lib/alerts";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgOpenClaims, pgRecordPayoutRun } from "@/lib/db/rewards";

/**
 * Pays a coin's holders automatically — the piece that used to be a holder clicking "Reclamar". Reuses the
 * EXACT SAME safety machinery the manual claim route always had (reserve in Postgres before a lamport moves,
 * confirm on-chain success, release on definite failure, keep on an unknown outcome for next time to resolve —
 * see src/lib/rewards/ledger.ts): only who triggers it, and that several holders are paid in one transaction
 * instead of one each, are new. Called once per registered mint by the collect-fees cron, right after it
 * collects that mint's creator fees into the Rewards Pool — so the SOL only ever passes through the pool in
 * transit, never sits there "belonging" to PANDA.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111111111112";
/** Transfers per transaction — well inside Solana's ~1232-byte transaction size limit for plain SystemProgram
 *  transfers (each is ~64 bytes of instruction data plus 2 account keys), with headroom for the fee payer. */
const BATCH_SIZE = 10;
/** A transfer under this wouldn't even survive as a new system account (rent-exempt minimum) — the same floor
 *  src/lib/pump/fee-transfer.ts already uses for referral payouts. */
const MIN_PAYOUT_LAMPORTS_PER_WALLET = 890_880;
/** Never let a payout drain the pool below what it needs to keep signing (fees + rent headroom) — same margin the old claim route kept. */
const POOL_RESERVE_LAMPORTS = 10_000_000;

export type HolderPayoutRunOutcome = {
  ran: boolean;
  reason?: "below_threshold" | "nothing_eligible" | "nothing_reserved" | "pool_too_low" | "error";
  holdersPaid: number;
  lamportsPaid: number;
  signatures: string[];
};

/** Best-effort audit row — never lets a logging failure undo real money already sent (the try/catch around it mirrors every other `alertOps`-style side channel in this codebase). */
async function recordRun(row: { id: string; mint: string; status: "done" | "failed"; holdersPaid: number; lamportsPaid: number; error?: string; startedAt: Date }): Promise<void> {
  try {
    await pgRecordPayoutRun(getDb(), row);
  } catch (err) {
    if (!(err instanceof DbNotConfiguredError)) console.error("[PANDA holder-payout] couldn't record the run", err);
  }
}

/**
 * Resolves any claim left "sent" by a run that crashed or timed out before it could confirm its own outcome
 * (a batch whose confirmation threw — see below) — the SAME review a human would have had to do by hand for a
 * stuck manual claim, just automatic: check what the signature really did on-chain, and either confirm it
 * (the SOL did land) or release the reservation (it never did, so it's claimable again). A claim still "reserved"
 * (never even sent) is left alone here — see the module doc for why that's a narrow, rare window. Call this
 * BEFORE a new payout round for the same mints, so a stuck reservation's balance is freed up again in time to
 * be included in this run rather than waiting for the next one.
 */
export async function resolveOpenClaims(connection: Connection): Promise<{ confirmed: number; released: number }> {
  let confirmed = 0;
  let released = 0;
  let open: Awaited<ReturnType<typeof pgOpenClaims>>;
  try {
    open = await pgOpenClaims(getDb());
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return { confirmed: 0, released: 0 };
    throw err;
  }
  for (const claim of open) {
    if (claim.status !== "sent" || !claim.signature) continue;
    const reservation: Reservation = { id: claim.id, mint: claim.mint, holder: claim.wallet, amount: claim.lamports, pgId: claim.id };
    try {
      const { value } = await connection.getSignatureStatuses([claim.signature]);
      const status = value[0];
      if (!status) continue; // still unknown — try again next run, same as before
      if (status.err) {
        await releaseClaim(reservation);
        await releaseDailyPayout(claim.lamports);
        released++;
      } else if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        await confirmClaim(reservation);
        confirmed++;
      }
    } catch (err) {
      console.error("[PANDA holder-payout] couldn't resolve an open claim", claim.id, err);
    }
  }
  return { confirmed, released };
}

export async function runHolderPayout(connection: Connection, signer: Keypair, mint: string): Promise<HolderPayoutRunOutcome> {
  const startedAt = new Date();
  const runId = randomUUID();
  try {
    const ledger = await getLedger(mint);
    const wallets = Object.keys(ledger.holders);
    const pending = wallets.reduce((s, w) => s + unclaimedLamports(ledger, w), 0);
    if (!shouldRunPayout(pending, HOLDER_PAYOUT_MIN_LAMPORTS)) {
      return { ran: false, reason: "below_threshold", holdersPaid: 0, lamportsPaid: 0, signatures: [] };
    }

    // Exclude: this coin's own fee-split shareholders (the creator, PANDA's treasury, the Rewards Pool itself —
    // they're paid their own share directly by distributeCreatorFees already, never again from the Holders
    // pool), and anything that isn't a plain, ordinary wallet (the bonding curve, the AMM pool, any other
    // program-derived account) — checked for real against what each address's account is actually owned by,
    // never guessed from a PDA derivation that could silently go stale with an SDK update.
    const mintKey = new PublicKey(mint);
    const raw = await getRawSharingConfig(connection, mintKey).catch(() => null);
    const exclude = new Set<string>([
      ...(raw ? raw.config.shareholders.map((s) => s.address.toBase58()) : []),
      PANDA_TREASURY.toBase58(),
      ...(PANDA_REWARDS_POOL ? [PANDA_REWARDS_POOL.toBase58()] : []),
    ]);

    const candidates = wallets.filter((w) => !exclude.has(w) && unclaimedLamports(ledger, w) > 0);
    if (candidates.length > 0) {
      const infos = await connection.getMultipleAccountsInfo(candidates.map((w) => new PublicKey(w)));
      candidates.forEach((w, i) => {
        const owner = infos[i]?.owner?.toBase58();
        if (owner && owner !== SYSTEM_PROGRAM_ID) exclude.add(w);
      });
    }

    const balances: HolderBalance[] = wallets.map((w) => ({ wallet: w, unclaimedLamports: unclaimedLamports(ledger, w) }));
    const eligible = computeEligiblePayouts(balances, { exclude, minPerWalletLamports: MIN_PAYOUT_LAMPORTS_PER_WALLET, maxPerWalletLamports: MAX_CLAIM_LAMPORTS });
    if (eligible.length === 0) {
      return { ran: false, reason: "nothing_eligible", holdersPaid: 0, lamportsPaid: 0, signatures: [] };
    }

    // Reserve every holder's share BEFORE sending anything — same order the manual claim route always used,
    // just for a whole round at once: nothing is sent until every wallet's cut is locked in Postgres, so a
    // concurrent sync or a second cron invocation can never see (and pay) the same balance twice.
    const booked: { wallet: string; reservation: Reservation }[] = [];
    let totalReserved = 0;
    for (const p of eligible) {
      if (!(await reserveDailyPayout(p.lamports))) {
        await alertOps("Holder payout paused for today — daily cap reached", { mint, wallet: p.wallet, lamportsWanted: p.lamports });
        break; // the daily cap is shared across every coin and holder; stop asking for more once it's full
      }
      const reservation = await reserveClaim(mint, p.wallet, p.lamports, runId);
      if (reservation.amount <= 0) {
        await releaseDailyPayout(p.lamports);
        continue;
      }
      if (reservation.amount < p.lamports) await releaseDailyPayout(p.lamports - reservation.amount);
      totalReserved += reservation.amount;
      booked.push({ wallet: p.wallet, reservation });
    }

    if (booked.length === 0) {
      return { ran: false, reason: "nothing_reserved", holdersPaid: 0, lamportsPaid: 0, signatures: [] };
    }

    const poolBalance = await connection.getBalance(signer.publicKey);
    if (poolBalance < totalReserved + POOL_RESERVE_LAMPORTS) {
      for (const { reservation } of booked) await releaseClaim(reservation);
      for (const { reservation } of booked) await releaseDailyPayout(reservation.amount);
      await alertOps("Rewards Pool balance too low for an automatic holder payout", { mint, poolSol: poolBalance / LAMPORTS_PER_SOL, neededSol: totalReserved / LAMPORTS_PER_SOL });
      return { ran: false, reason: "pool_too_low", holdersPaid: 0, lamportsPaid: 0, signatures: [] };
    }

    const batches = batchPayouts(booked, BATCH_SIZE);
    const signatures: string[] = [];
    let holdersPaid = 0;
    let lamportsPaid = 0;

    for (const batch of batches) {
      const tx = new Transaction();
      for (const { wallet, reservation } of batch) {
        tx.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(wallet), lamports: reservation.amount }));
      }
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = signer.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(signer);

      let signature: string;
      try {
        signature = await connection.sendRawTransaction(tx.serialize());
      } catch (err) {
        for (const { reservation } of batch) await releaseClaim(reservation);
        for (const { reservation } of batch) await releaseDailyPayout(reservation.amount);
        await alertOps("A holder payout batch could not be sent — nothing in it was paid", { mint, error: String(err), holders: batch.map((b) => b.wallet) });
        continue; // one bad batch shouldn't stop the rest of this round
      }

      for (const { reservation } of batch) await markClaimSent(reservation, signature);

      try {
        const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (confirmation.value.err) {
          for (const { reservation } of batch) await releaseClaim(reservation);
          for (const { reservation } of batch) await releaseDailyPayout(reservation.amount);
          await alertOps("A holder payout batch failed on-chain — nothing in it was paid", { mint, signature, err: confirmation.value.err });
          continue;
        }
      } catch (err) {
        // Unknown outcome: the reservations stay "sent" (can't be paid again) — the NEXT run resolves them the
        // same way the old claim flow asked a human to: check the signature, confirm or release by hand if it
        // truly never lands. Still counted here as "sent", not silently dropped.
        await alertOps("Holder payout batch outcome UNKNOWN — reservations kept, check the signature manually", { mint, signature, error: String(err), holders: batch.map((b) => b.wallet) });
        signatures.push(signature);
        continue;
      }

      for (const { reservation } of batch) await confirmClaim(reservation);
      signatures.push(signature);
      holdersPaid += batch.length;
      lamportsPaid += batch.reduce((s, b) => s + b.reservation.amount, 0);
    }

    await recordRun({ id: runId, mint, status: "done", holdersPaid, lamportsPaid, startedAt });
    return { ran: true, holdersPaid, lamportsPaid, signatures };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun({ id: runId, mint, status: "failed", holdersPaid: 0, lamportsPaid: 0, error: message.slice(0, 500), startedAt });
    await alertOps("Holder payout run crashed", { mint, error: message });
    return { ran: false, reason: "error", holdersPaid: 0, lamportsPaid: 0, signatures: [] };
  }
}
