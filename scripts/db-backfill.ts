/**
 * db-backfill — copies what Blob holds into Postgres (a re-snapshot: safe to run again). NEVER writes to Blob.
 *
 *   npm run db:backfill [-- --domains rewards,trades,activity,pause] [--yes] [--force]
 *
 * Without --yes it only READS Blob and prints what would be imported (a dry run). With --yes it writes to Postgres.
 * For the money domain (rewards) it refuses to run unless the "claims" and "fee_processing" switches are PAUSED (so nothing writes to
 * Blob while the snapshot is taken) — unless the Blob ledger holds no balances at all; --force skips that check and is only for an empty or throwaway database.
 *
 * Order for a domain: pause it (admin panel) → db:backfill --yes → set PANDA_STORAGE_MODES=<domain>=dual → unpause →
 * db:compare daily for two days → set <domain>=postgres. docs/PHASE6_PLAN.md §1.4.
 * Needs BLOB_READ_WRITE_TOKEN and DATABASE_URL in the environment (`vercel env pull .env.local`).
 */
import { getDb } from "../src/lib/db/client";
import { DOMAINS, type Domain } from "../src/lib/db/mode";
import { blobSource } from "../src/lib/db/source";
import { backfill } from "../src/lib/db/backfill";
import { isPaused } from "../src/lib/protocol/pause";

function domainsArg(): Domain[] {
  const i = process.argv.indexOf("--domains");
  if (i < 0) return [...DOMAINS];
  const wanted = (process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = wanted.filter((d) => !(DOMAINS as readonly string[]).includes(d));
  if (bad.length || wanted.length === 0) {
    console.error(`Unknown domain(s): ${bad.join(", ") || "(none given)"}. Domains: ${DOMAINS.join(", ")}`);
    process.exit(2);
  }
  return wanted as Domain[];
}

async function main() {
  const domains = domainsArg();
  const source = blobSource();
  const yes = process.argv.includes("--yes");

  if (domains.includes("rewards") && !process.argv.includes("--force")) {
    const state = await source.pause();
    const notPaused = (["claims", "fee_processing"] as const).filter((s) => !isPaused(state, s));
    if (notPaused.length) {
      // Nothing to protect when the ledger holds no balances at all: an empty snapshot can't lose or double anything.
      let holders = 0;
      for (const m of await source.registry()) holders += Object.keys((await source.ledger(m)).holders).length;
      if (holders > 0) {
        console.error(`Refusing to back up the rewards ledger while money can still move: pause ${notPaused.join(" and ")} first (admin panel), or use --force on an empty/throwaway database.`);
        process.exit(2);
      }
      console.log("(the rewards ledger has no holder balances yet, so it is safe to import without pausing)");
    }
  }

  if (!yes) {
    console.log("DRY RUN — reading Blob only, nothing is written. Add --yes to import.\n");
    if (domains.includes("rewards")) {
      const mints = await source.registry();
      let holders = 0;
      for (const m of mints) holders += Object.keys((await source.ledger(m)).holders).length;
      console.log(`rewards: ${mints.length} coins, ${holders} holder balances`);
    }
    if (domains.includes("trades")) {
      const wallets = await source.tradeWallets();
      let n = 0;
      for (const w of wallets) n += (await source.trades(w)).length;
      console.log(`trades: ${wallets.length} wallets, ${n} trades, ${(await source.backfillMarks()).length} scan markers`);
    }
    if (domains.includes("activity")) console.log(`activity: ${(await source.journal()).reduce((s, d) => s + d.events.length, 0)} journal events, ${(await source.economyDays()).length} economy days`);
    if (domains.includes("pause")) console.log(`pause: ${Object.keys((await source.pause()).subsystems).length} switches`);
    if (domains.includes("audit")) console.log(`audit: ${(await source.audit()).length} events`);
    if (domains.includes("launch")) console.log(`launch: ${Object.keys(await source.feeLocks()).length} coins waiting for their fee split`);
    return;
  }

  const reports = await backfill(getDb(), source, domains, (line) => console.log(line));
  const problems = reports.flatMap((r) => r.problems);
  for (const p of problems) console.error("PROBLEM", p);
  console.log(problems.length ? `\nDone WITH ${problems.length} PROBLEM(S): those items were NOT imported. Fix them before switching the domain.` : "\nDone. Now run: npm run db:compare");
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
