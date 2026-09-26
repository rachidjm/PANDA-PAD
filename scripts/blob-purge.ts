/**
 * blob-purge — deletes the FROZEN Blob copies of the data that now lives in Postgres (rewards, trades, activity, pause, audit, sessions'
 * nonces, launch registry). DRY RUN by default: it lists what it would delete and deletes nothing.
 *
 *   npm run blob:purge                      dry run
 *   npm run blob:purge -- --yes             really delete (permanent!)
 *   npm run blob:purge -- --min-age-days 30 (default 30: the retention period after the copy froze)
 *
 * It never touches images, metadata or the files of features that are not in Postgres (points, airdrops, themes/NFT, market, branches,
 * abuse, strategies, OTC): only paths on the allowlist in src/lib/db/blob-purge.ts. It REFUSES to delete unless ALL of these hold:
 *   1. PANDA_STORAGE_MODES has every domain on `postgres` (otherwise Blob is still the source of truth for something);
 *   2. `db:compare` finds no difference (nothing in Blob that Postgres lacks) and the audit hash chain verifies;
 *   3. the newest frozen file is at least --min-age-days old (the way back is still open until then).
 * Needs BLOB_READ_WRITE_TOKEN, DATABASE_URL and PANDA_STORAGE_MODES in the environment. Vercel never hands "Sensitive" variables to a
 * laptop, so either paste the Blob token from the Vercel dashboard into your shell for one run, or run it where they exist — in the
 * Vercel build: `vercel deploy --prod --build-env PANDA_BUILD_TASKS=purge-blob` (dry run) and add `--build-env PANDA_BUILD_PURGE=yes`.
 * Prints counts, sizes and dates — never a URL of a blob's content or a secret.
 */
import { del, list } from "@vercel/blob";
import { getDb } from "../src/lib/db/client";
import { DOMAINS, parseStorageModes } from "../src/lib/db/mode";
import { blobSource } from "../src/lib/db/source";
import { compare } from "../src/lib/db/compare";
import { pgVerifyChain } from "../src/lib/db/audit";
import { PURGE_LIST_PREFIXES, planPurge, type BlobMeta } from "../src/lib/db/blob-purge";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const yes = process.argv.includes("--yes") || process.env.PANDA_BUILD_PURGE === "yes";
const minAgeDays = Number(arg("min-age-days") ?? process.env.PANDA_PURGE_MIN_AGE_DAYS ?? 30);

const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN || process.env.PANDA_PAD_BLOB_READ_WRITE_TOKEN;

async function listAll(): Promise<BlobMeta[]> {
  const out: BlobMeta[] = [];
  for (const prefix of PURGE_LIST_PREFIXES) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor, token });
      for (const b of page.blobs) out.push({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: new Date(b.uploadedAt) });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  return out;
}

async function main() {
  if (!token) return fail("No Blob token in the environment (BLOB_READ_WRITE_TOKEN).");
  if (!Number.isFinite(minAgeDays) || minAgeDays < 0) return fail("--min-age-days must be a number of days.");
  console.log(`blob-purge ${yes ? "— REAL DELETION" : "— dry run (nothing is deleted)"}; retention ${minAgeDays} days`);

  // 1. every domain must already be in Postgres
  const { modes } = parseStorageModes(process.env.PANDA_STORAGE_MODES);
  const notPg = DOMAINS.filter((d) => modes[d] !== "postgres");
  if (notPg.length) return fail(`Refusing: these domains are not in "postgres" mode: ${notPg.join(", ")}. Blob is still their source of truth or a way back.`);
  console.log(`OK   all ${DOMAINS.length} domains are in postgres mode`);

  // 2. nothing in Blob that Postgres lacks, and the audit chain is intact
  const db = getDb();
  const reports = await compare(db, blobSource(), [...DOMAINS], modes);
  const diffs = reports.flatMap((r) => r.differences.map((d) => `${r.domain}: ${d}`));
  if (diffs.length) return fail(`Refusing: db:compare found ${diffs.length} difference(s) — Blob holds something Postgres doesn't:\n  ${diffs.slice(0, 10).join("\n  ")}`);
  const chain = await pgVerifyChain(db);
  if (!chain.ok) return fail(`Refusing: the audit hash chain is broken at seq ${chain.problem?.seq}.`);
  console.log(`OK   db:compare has no differences; audit chain verified (${chain.checked} events)`);

  // 3. what would go, and whether the retention period is over
  const plan = planPurge(await listAll(), Date.now(), minAgeDays);
  const byFolder = new Map<string, { n: number; bytes: number }>();
  for (const b of plan.toDelete) {
    const key = b.pathname.split("/").slice(0, 2).join("/").replace(/\.json$/, "");
    const cur = byFolder.get(key) ?? { n: 0, bytes: 0 };
    byFolder.set(key, { n: cur.n + 1, bytes: cur.bytes + b.size });
  }
  for (const [k, v] of [...byFolder].sort()) console.log(`     ${k.padEnd(34)} ${String(v.n).padStart(5)} file(s)  ${v.bytes} bytes`);
  console.log(`     TOTAL ${plan.toDelete.length} file(s), ${plan.bytes} bytes (frozen copies only; images, metadata and other features are not listed)`);
  if (plan.ignored.length) return fail(`Refusing: ${plan.ignored.length} listed file(s) are off the allowlist (a bug): ${plan.ignored.slice(0, 5).map((b) => b.pathname).join(", ")}`);
  if (plan.toDelete.length === 0) {
    console.log("Nothing to delete.");
    return process.exit(0);
  }
  console.log(`     newest frozen write: ${new Date(plan.newestUploadedAt!).toISOString()}; deletion allowed from ${plan.allowedFrom}`);
  if (plan.tooFresh) return fail(`Refusing: the retention period isn't over yet (allowed from ${plan.allowedFrom}). Use --min-age-days 0 only if you are sure.`);

  if (!yes) {
    console.log("\nDRY RUN OK — run again with --yes to delete these files permanently.");
    return process.exit(0);
  }
  let deleted = 0;
  for (let i = 0; i < plan.toDelete.length; i += 100) {
    const batch = plan.toDelete.slice(i, i + 100);
    await del(batch.map((b) => b.url), { token });
    deleted += batch.length;
  }
  console.log(`\nDELETED ${deleted} file(s).`);
  process.exit(0);
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
