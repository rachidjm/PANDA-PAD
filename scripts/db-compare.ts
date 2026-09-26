/**
 * db-compare — READ-ONLY comparison of what Blob holds and what Postgres holds, per domain. Writes nothing anywhere.
 *
 *   npm run db:compare [-- --domains rewards,trades,activity,pause]
 *
 * Exit code 0 = no differences; 1 = differences (listed) — do NOT switch a domain to "postgres" until it is 0 for two days in "dual".
 * A domain in "postgres" mode has a frozen Blob copy: Postgres being ahead of it is printed as NOTE (expected), while anything Blob has that
 * Postgres lacks is still a DIFF. Warnings (a payout that was sent with no recorded outcome) don't change the exit code but must be looked at by a human.
 * Needs BLOB_READ_WRITE_TOKEN and DATABASE_URL in the environment (`vercel env pull .env.local`).
 */
import { getDb } from "../src/lib/db/client";
import { DOMAINS, parseStorageModes, type Domain } from "../src/lib/db/mode";
import { blobSource } from "../src/lib/db/source";
import { compare } from "../src/lib/db/compare";

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
  const reports = await compare(getDb(), blobSource(), domainsArg(), parseStorageModes(process.env.PANDA_STORAGE_MODES).modes);
  let bad = 0;
  for (const r of reports) {
    console.log(`\n${r.domain}: ${r.checked} checked — ${r.differences.length === 0 ? "no differences" : `${r.differences.length} DIFFERENCE(S)`}`);
    for (const d of r.differences) console.log("  DIFF ", d);
    for (const n of r.notes) console.log("  NOTE ", n);
    for (const w of r.warnings) console.log("  WARN ", w);
    bad += r.differences.length;
  }
  console.log(bad === 0 ? "\nCOMPARE OK" : `\nCOMPARE FAILED (${bad})`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
