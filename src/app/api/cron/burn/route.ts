import { NextResponse } from "next/server";
import { Connection, type Keypair } from "@solana/web3.js";
import { alertOps } from "@/lib/alerts";
import { recordAudit } from "@/lib/audit/log";
import { catchUpBurnAccruals } from "@/lib/burn/accrue";
import { burnEnabled, burnMinLamports, getBurnSigner } from "@/lib/burn/config";
import { resolveOpenBurnTxs, runBurnForMint, type BurnOutcome } from "@/lib/burn/run";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { getDb } from "@/lib/db/client";
import { pgBurnBalances } from "@/lib/db/burn";
import { checkActive } from "@/lib/protocol/pause-store";
import { getRegisteredMints } from "@/lib/rewards/registry";
import { serverRpcUrl } from "@/lib/solana/rpc";

// Every 5 minutes. A coin that isn't reached within the budget simply waits for the next run.
const TIME_BUDGET_MS = 45_000;
export const maxDuration = 60;

/**
 * Burn (FEATURE_BURN, src/lib/burn): for every coin whose Burn share has gathered at least BURN_MIN_SOL in PANDA's burn
 * wallet, buys that coin with it and burns what was bought. Before anything new: transactions a previous run left
 * unsettled are settled from the chain, and distributions that paid the wallet without being booked are booked.
 * Stops entirely — nothing bought, nothing burned — with the flag off, the money-flow guard closed or "burns" paused.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse(null, { status: 404 });
  if (!burnEnabled()) return NextResponse.json({ skipped: "FEATURE_BURN is off or the burn wallet isn't configured" });
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;

  let signer: Keypair | null;
  try {
    signer = getBurnSigner();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Burn wallet signer is invalid.";
    await alertOps("Burn wallet signer is misconfigured — nothing was bought or burned", { error: message });
    return NextResponse.json({ skipped: "burn_signer_invalid", error: message });
  }
  if (!signer) return NextResponse.json({ skipped: "PANDA_BURN_WALLET_SECRET_KEY not set" });

  try {
    const started = Date.now();
    const db = getDb();
    const connection = new Connection(serverRpcUrl(), "confirmed");
    // Only confirms what already happened on-chain: runs even while paused.
    const resolved = await resolveOpenBurnTxs(connection, db).catch(() => 0);
    const caught = await catchUpBurnAccruals(connection, db, signer.publicKey, await getRegisteredMints()).catch((err) => {
      console.error("[PANDA burn] catching up accruals failed", err);
      return { booked: [], ambiguous: [] as string[] };
    });
    for (const signature of caught.ambiguous) await alertOps("A fee distribution that paid the burn wallet touches several coins — its Burn share was NOT booked, check it by hand", { signature });

    if ((await checkActive("burns")).paused) return NextResponse.json({ skipped: "burns is paused", resolved, booked: caught.booked.length });

    const min = burnMinLamports();
    const results: BurnOutcome[] = [];
    // Every coin with something booked: one that is under the minimum still gets anything it holds burned.
    for (const b of (await pgBurnBalances(db)).sort((x, y) => y.pendingLamports - x.pendingLamports)) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const r = await runBurnForMint(connection, db, signer, b.mint, min);
      if (r.bought || r.burned || r.error) results.push(r);
      // Retried every run; said to the operators once an hour, not every five minutes.
      if (r.error && new Date().getUTCMinutes() < 5) await alertOps("A buy-and-burn round failed for a coin — it is retried on every run", { mint: b.mint, error: r.error });
    }
    await recordAudit({
      actor: "system:cron",
      action: "cron.burn",
      object: "burn_wallet",
      newState: {
        resolved,
        booked: caught.booked.length,
        coins: results.length,
        bought: results.filter((r) => r.bought).length,
        burned: results.filter((r) => r.burned).length,
        failed: results.filter((r) => r.error).length,
        spentLamports: results.reduce((s, r) => s + (r.bought?.lamports ?? 0), 0),
      },
    });
    return NextResponse.json({ resolved, booked: caught.booked.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Burn cron failed.";
    await alertOps("burn cron run failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
