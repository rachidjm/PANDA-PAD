/**
 * migrate-founder-slots-to-new-rule — ONE-TIME: the Founder-slot rule changed from "a recruiter's first-ever
 * bound invitee" to "founderRequiredTraders() invitees who each traded founderMinTraderVolumeUsd()+ of their
 * own volume" (anti-abuse needs no separate recheck — every bound invitee already passed it at bind time, by
 * construction, see src/lib/referrals/bind.ts). Any slot reserved under the OLD rule that does NOT also satisfy
 * the NEW one is released. Rank numbering is left with gaps rather than re-packed — a live site must never have
 * an existing Founder's rank change under them.
 *
 *   npm run migrate-founder-slots -- --yes     (dry run without --yes — only reports what WOULD change)
 *
 * This also runs as the "migrate-founder-slots" PANDA_BUILD_TASKS task (scripts/vercel-build.ts), where it
 * needs PANDA_BUILD_MIGRATE_FOUNDERS=yes to actually write.
 *
 * A reserved-but-already-MINTED slot is never released automatically, even if it no longer satisfies the new
 * rule — that would mean clawing back a real NFT, which needs a human decision, not a script. It's reported
 * separately so you can see if any exist (there shouldn't be any yet: the Founder NFT collection hasn't been
 * created).
 *
 * Needs DATABASE_URL.
 */
import { getDb } from "../src/lib/db/client";
import { pgAllFounderAllocations, pgCountValidInvitees, pgReleaseFounderSlot } from "../src/lib/db/referrals";
import { founderMinTraderVolumeUsd, founderRequiredTraders } from "../src/lib/referrals/tiers-config";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL isn't set. Aborting without touching anything.");
    process.exit(2);
  }
  const yes = process.argv.includes("--yes");
  const db = getDb();
  const threshold = founderMinTraderVolumeUsd();
  const required = founderRequiredTraders();

  const allocations = await pgAllFounderAllocations(db);
  console.log(`${allocations.length} Founder allocation(s) exist today (new rule: ${required} invitees each with $${threshold}+ of their own volume).`);

  let kept = 0;
  let released = 0;
  let skippedMinted = 0;

  for (const a of allocations) {
    const validCount = await pgCountValidInvitees(db, a.wallet, threshold);
    const satisfiesNewRule = validCount >= required;

    if (satisfiesNewRule) {
      kept++;
      continue;
    }
    if (a.mintedAt !== null) {
      skippedMinted++;
      console.log(`  KEEP (already minted, needs a human decision): wallet ${a.wallet} (rank #${a.rank}) has only ${validCount}/${required} valid invitees under the new rule.`);
      continue;
    }
    console.log(`  ${yes ? "RELEASING" : "would release"}: wallet ${a.wallet} (rank #${a.rank}, unminted) — only ${validCount}/${required} valid invitees.`);
    if (yes) {
      if (await pgReleaseFounderSlot(db, a.wallet)) released++;
    } else {
      released++;
    }
  }

  console.log(`\n${yes ? "Done" : "DRY RUN — nothing written. Add --yes to release these for real"}.`);
  console.log(`Kept (already satisfy the new rule): ${kept}`);
  console.log(`Released (reserved under the old rule, not yet minted): ${released}`);
  if (skippedMinted > 0) console.log(`Skipped — already minted, needs a human decision: ${skippedMinted}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
