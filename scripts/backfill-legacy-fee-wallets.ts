/**
 * backfill-legacy-fee-wallets — ONE-TIME: snapshots every wallet that has ever traded on PANDA as of right
 * now into legacy_fee_wallets, so the two-tier trading fee (src/lib/pump/fee-tier.ts) grandfathers every
 * existing user onto the lower, referred rate automatically — exactly as the spec asked for ("todas las
 * wallets que ya hayan operado en PANDA antes de este cambio mantienen el 0,5% automáticamente").
 *
 *   npm run backfill-legacy-fee-wallets
 *
 * Run this ONCE, right when the two-tier fee deploys — never again afterward (a wallet that first trades
 * AFTER this runs is correctly NOT in this table, so it pays the new default rate unless it has its own
 * recruiter). Safe to re-run anyway: already-marked wallets are skipped (onConflictDoNothing), so running it
 * twice by mistake just does nothing the second time — it does NOT pick up wallets that started trading
 * between the two runs, which is exactly the point.
 *
 * Needs DATABASE_URL in the environment.
 */
import { getDb } from "../src/lib/db/client";
import { pgDistinctTradeWallets } from "../src/lib/db/trades";
import { pgCountLegacyFeeWallets, pgMarkLegacyFeeWallet } from "../src/lib/db/fee-tier";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL isn't set. Aborting without touching anything.");
    process.exit(2);
  }
  const db = getDb();
  const before = await pgCountLegacyFeeWallets(db);
  console.log(`legacy_fee_wallets already has ${before} wallet(s).`);

  const wallets = await pgDistinctTradeWallets(db);
  console.log(`${wallets.length} distinct wallet(s) have ever traded on PANDA.`);

  const now = Date.now();
  let marked = 0;
  for (const wallet of wallets) {
    if (await pgMarkLegacyFeeWallet(db, wallet, now)) marked++;
  }
  console.log(`Marked ${marked} new wallet(s) as legacy (grandfathered onto the referred/legacy fee rate).`);
  console.log(`legacy_fee_wallets now has ${await pgCountLegacyFeeWallets(db)} wallet(s) total.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
