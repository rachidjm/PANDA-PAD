import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection } from "@solana/web3.js";
import { getRegisteredMints } from "@/lib/rewards/registry";
import { creditHolders, getLedger, unclaimedLamports } from "@/lib/rewards/ledger";
import { getRewardsPoolSigner } from "@/lib/pump/rewards-pool-signer";
import { alertOps } from "@/lib/alerts";
import { collectFeesForMint } from "@/lib/pump/distribute";
import { getTokenHolders, totalHolderAmount } from "@/lib/solana/holders";

// Vercel Hobby's function timeout is 30s — leave a real safety margin so a
// slow mint mid-batch can't blow past it; unstarted mints just wait for the
// next daily run instead of failing the whole invocation.
const TIME_BUDGET_MS = 25_000;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unguarded
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const started = Date.now();
    const connection = new Connection(serverRpcUrl(), "confirmed");

    const mints = await getRegisteredMints();
    const results: { mint: string; distributedLamports: number | null; holdersCredited: number; error?: string }[] = [];

    for (const mint of mints) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      try {
        // Sequential, not concurrent — the Rewards Pool wallet's balance is
        // shared across every mint, so measuring one mint's real contribution
        // requires nothing else touching that balance while it's in flight.
        const distributed = await collectFeesForMint(connection, mint);
        if (!distributed) {
          results.push({ mint, distributedLamports: null, holdersCredited: 0 });
          continue;
        }

        const holders = await getTokenHolders(connection, mint);
        const total = totalHolderAmount(holders);
        if (total <= 0) {
          results.push({ mint, distributedLamports: distributed, holdersCredited: 0 });
          continue;
        }

        const credits = holders.map((h) => ({
          address: h.address,
          lamports: Math.floor((h.amount / total) * distributed),
        }));
        await creditHolders(mint, distributed, credits);
        results.push({ mint, distributedLamports: distributed, holdersCredited: credits.length });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error.";
        results.push({ mint, distributedLamports: null, holdersCredited: 0, error });
        await alertOps("Fee collection failed for a coin — fees may sit unattributed until it's fixed", { mint, error });
      }
    }

    // Solvency check: what the pool owes holders vs what it holds. Cheap (one ledger read per coin), skipped if out of time.
    const pool = getRewardsPoolSigner();
    if (pool && Date.now() - started < TIME_BUDGET_MS) {
      try {
        let owedLamports = 0;
        for (const mint of mints) {
          const ledger = await getLedger(mint);
          for (const holder of Object.keys(ledger.holders)) owedLamports += unclaimedLamports(ledger, holder);
        }
        const balance = await connection.getBalance(pool.publicKey);
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

    return NextResponse.json({ processed: results.length, ofRegistered: mints.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron run failed.";
    await alertOps("collect-fees cron run failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
