import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection } from "@solana/web3.js";
import { getRegisteredMints } from "@/lib/rewards/registry";
import { creditHolders, getLedger, unclaimedLamports } from "@/lib/rewards/ledger";
import { resolveOpenClaims, runHolderPayout } from "@/lib/rewards/run-payout";
import { getRewardsPoolSigner } from "@/lib/pump/rewards-pool-signer";
import { alertOps } from "@/lib/alerts";
import { pausedResponse } from "@/lib/protocol/guard";
import { recordAudit } from "@/lib/audit/log";
import { collectFeesForMint } from "@/lib/pump/distribute";
import { getTokenHolders } from "@/lib/solana/holders";
import { computeHolderCredits } from "@/lib/rewards/split";
import { recordActivity } from "@/lib/activity/record";
import { breakdown } from "@/lib/economy/shares";
import { PANDA_REWARDS_POOL, PANDA_TREASURY } from "@/lib/pump/constants";
import { resolveAllPending } from "@/lib/pump/fee-lock";

// Runs every 5 minutes now (Vercel Pro) — a wide margin under maxDuration below, so a slow mint mid-batch
// can't blow past it; an unstarted mint just waits for the next run (5 minutes away) instead of failing the
// whole invocation.
const TIME_BUDGET_MS = 50_000;
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unguarded
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return new NextResponse(null, { status: 404 }); // a stranger learns nothing, not even that the route exists
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  // Coins launched in two transactions whose split is still missing: keep the registry honest (and audit them) even if nobody opens them.
  await resolveAllPending(new Connection(serverRpcUrl(), "confirmed"))
    .then((r) => r.waiting > 0 && console.warn(`[PANDA fee-lock] ${r.waiting} coin(s) still waiting for their fee split`))
    .catch((err) => console.error("[PANDA fee-lock] daily resolve failed", err));
  if (await pausedResponse("fee_processing")) return NextResponse.json({ skipped: "fee_processing is paused" });

  try {
    const started = Date.now();
    const connection = new Connection(serverRpcUrl(), "confirmed");

    // Resolve anything a prior run left "sent" with no confirmed outcome BEFORE trying anything new — see
    // src/lib/rewards/run-payout.ts's resolveOpenClaims for why this always runs first.
    await resolveOpenClaims(connection).catch((err) => console.error("[PANDA holder-payout] resolving open claims failed", err));

    const mints = await getRegisteredMints();
    const results: { mint: string; distributedLamports: number | null; holdersCredited: number; payout?: { ran: boolean; reason?: string; holdersPaid: number; lamportsPaid: number }; error?: string }[] = [];
    const payoutSigner = getRewardsPoolSigner();

    // Pays out a mint's Holders pool automatically if it's grown past the threshold — called at every exit
    // point below, whether or not THIS round collected anything new (a prior round's leftovers can cross the
    // threshold on their own once combined with a fresh collection, or a payout that failed earlier can finally
    // go through once the pool is funded again). A no-op, cheap read when there's nothing to do.
    async function tryPayout(mint: string): Promise<{ ran: boolean; reason?: string; holdersPaid: number; lamportsPaid: number } | undefined> {
      if (!payoutSigner) return undefined;
      const outcome = await runHolderPayout(connection, payoutSigner, mint);
      return { ran: outcome.ran, reason: outcome.reason, holdersPaid: outcome.holdersPaid, lamportsPaid: outcome.lamportsPaid };
    }

    for (const mint of mints) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      try {
        // Sequential, not concurrent — the Rewards Pool wallet's balance is
        // shared across every mint, so measuring one mint's real contribution
        // requires nothing else touching that balance while it's in flight.
        const distributed = await collectFeesForMint(connection, mint);
        if (!distributed || distributed.lamports <= 0) {
          results.push({ mint, distributedLamports: null, holdersCredited: 0, payout: await tryPayout(mint) });
          continue;
        }
        // The distribution transaction is confirmed on-chain and its effect on the pool was measured: a verified event.
        await recordActivity({
          id: `fees:${distributed.signature}`,
          kind: "fee_distribution",
          ts: distributed.blockTimeMs ?? Date.now(),
          mint,
          lamports: distributed.lamports,
          signature: distributed.signature,
        }, (() => {
          // Analytics: how this distribution split, from its own transaction. If the split couldn't be read, only the
          // pool amount (measured separately) is counted and the rest stays unknown rather than guessed.
          const split = distributed.shares.length
            ? breakdown(distributed.shares, PANDA_TREASURY.toBase58(), (PANDA_REWARDS_POOL ?? PANDA_TREASURY).toBase58())
            : null;
          return {
            distributions: 1,
            creatorFeePoolLamports: split ? split.pool : distributed.lamports,
            ...(split ? { creatorFeeLamports: split.total, creatorFeeTreasuryLamports: split.treasury } : {}),
          };
        })());

        const holders = await getTokenHolders(connection, mint);
        if (holders.length === 0) {
          results.push({ mint, distributedLamports: distributed.lamports, holdersCredited: 0, payout: await tryPayout(mint) });
          continue;
        }

        // Integer-exact split by raw token balance; the rounding remainder is recorded as dust, never lost.
        const { credits, dust } = computeHolderCredits(holders, distributed.lamports);
        await creditHolders(mint, distributed.lamports, credits, dust, distributed.signature);
        results.push({ mint, distributedLamports: distributed.lamports, holdersCredited: credits.length, payout: await tryPayout(mint) });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error.";
        results.push({ mint, distributedLamports: null, holdersCredited: 0, error });
        await alertOps("Fee collection failed for a coin — fees may sit unattributed until it's fixed", { mint, error });
      }
    }

    // Solvency check: what the pool owes holders vs what it holds. Cheap (one ledger read per coin), skipped if out of time.
    if (payoutSigner && Date.now() - started < TIME_BUDGET_MS) {
      try {
        let owedLamports = 0;
        for (const mint of mints) {
          const ledger = await getLedger(mint);
          for (const holder of Object.keys(ledger.holders)) owedLamports += unclaimedLamports(ledger, holder);
        }
        const balance = await connection.getBalance(payoutSigner.publicKey);
        if (balance < owedLamports) {
          await alertOps("Rewards Pool holds LESS than it owes holders", {
            poolSol: balance / 1e9,
            owedSol: owedLamports / 1e9,
          });
        } else if (balance < 50_000_000) {
          await alertOps("Rewards Pool is nearly empty (under 0.05 SOL)", { poolSol: balance / 1e9 });
        }
      } catch (err) {
        console.error("Solvency check failed", err);
      }
    }

    const payoutHolders = results.reduce((sum, r) => sum + (r.payout?.holdersPaid ?? 0), 0);
    const payoutLamports = results.reduce((sum, r) => sum + (r.payout?.lamportsPaid ?? 0), 0);
    await recordAudit({
      actor: "system:cron",
      action: "cron.collect_fees",
      object: "registry",
      newState: {
        processed: results.length,
        ofRegistered: mints.length,
        failed: results.filter((r) => r.error).length,
        distributedLamports: results.reduce((sum, r) => sum + (r.distributedLamports ?? 0), 0),
        payoutHolders,
        payoutLamports,
      },
    });
    return NextResponse.json({ processed: results.length, ofRegistered: mints.length, payoutHolders, payoutLamports, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron run failed.";
    await alertOps("collect-fees cron run failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
