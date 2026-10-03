/**
 * backfill-legacy-fee-wallets — ONE-TIME: snapshots every wallet that has ever traded on PANDA as of right
 * now into legacy_fee_wallets, so the two-tier trading fee (src/lib/pump/fee-tier.ts) grandfathers every
 * existing user onto the lower, referred rate automatically — exactly as the spec asked for ("todas las
 * wallets que ya hayan operado en PANDA antes de este cambio mantienen el 0,5% automáticamente").
 *
 *   npm run backfill-legacy-fee-wallets -- --yes     (local, needs DATABASE_URL — e.g. via `vercel env pull .env.local`)
 *
 * Without --yes it only COUNTS and prints what would be marked — nothing is written (dry run). This also runs
 * as the "backfill-legacy-fees" PANDA_BUILD_TASKS task (scripts/vercel-build.ts), where it needs
 * PANDA_BUILD_LEGACY_FEES=yes (as a one-off `--build-env` on that single deployment, same pattern as the other
 * build tasks) to actually write — otherwise it only reports counts to the build log.
 *
 * Run the real (--yes) pass ONCE, right when the two-tier fee deploys — never again afterward (a wallet that
 * first trades AFTER this runs is correctly NOT in this table, so it pays the new default rate unless it has
 * its own recruiter). Safe to re-run anyway: already-marked wallets are skipped (onConflictDoNothing), so
 * running it twice by mistake just does nothing the second time — it does NOT pick up wallets that started
 * trading between the two runs, which is exactly the point.
 */
import { getDb } from "../src/lib/db/client";
import { pgDistinctTradeWallets } from "../src/lib/db/trades";
import { pgCountLegacyFeeWallets, pgIsLegacyFeeWallet, pgMarkLegacyFeeWallet } from "../src/lib/db/fee-tier";

/** Wallets worth naming individually in the log, so a human skimming the build output can confirm a specific
 *  one made it in without needing direct database access (e.g. PANDA_BUILD_TASKS runs where Sensitive env
 *  vars, and so DATABASE_URL, only exist inside the build itself). */
const WATCH_WALLETS = (process.env.PANDA_BUILD_WATCH_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL isn't set. Aborting without touching anything.");
    process.exit(2);
  }
  const yes = process.argv.includes("--yes");
  const db = getDb();
  const before = await pgCountLegacyFeeWallets(db);
  console.log(`legacy_fee_wallets already has ${before} wallet(s).`);

  const wallets = await pgDistinctTradeWallets(db);
  console.log(`${wallets.length} distinct wallet(s) have ever traded on PANDA.`);

  if (!yes) {
    console.log("DRY RUN — nothing written. Add --yes to mark these wallets for real.");
  } else {
    const now = Date.now();
    let marked = 0;
    for (const wallet of wallets) {
      if (await pgMarkLegacyFeeWallet(db, wallet, now)) marked++;
    }
    console.log(`Marked ${marked} new wallet(s) as legacy (grandfathered onto the referred/legacy fee rate).`);
    console.log(`legacy_fee_wallets now has ${await pgCountLegacyFeeWallets(db)} wallet(s) total.`);
  }

  for (const wallet of WATCH_WALLETS) {
    const traded = wallets.includes(wallet);
    const legacy = await pgIsLegacyFeeWallet(db, wallet);
    console.log(`  watch: ${wallet} — ${traded ? "has traded" : "no trades found"}, legacy-marked: ${legacy}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
