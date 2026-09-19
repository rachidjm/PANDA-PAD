import { NextResponse } from "next/server";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { getRegisteredMints } from "@/lib/rewards/registry";
import { creditHolders } from "@/lib/rewards/ledger";
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
    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");

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
        results.push({
          mint,
          distributedLamports: null,
          holdersCredited: 0,
          error: err instanceof Error ? err.message : "Unknown error.",
        });
      }
    }

    return NextResponse.json({ processed: results.length, ofRegistered: mints.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron run failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
