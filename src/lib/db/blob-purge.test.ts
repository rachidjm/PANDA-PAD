import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DOMAINS } from "./mode";
import { isMigratedBlobPath, MIGRATED_BLOB_PATHS, planPurge, type BlobMeta } from "./blob-purge";

const M = "M".repeat(43), W = "W".repeat(43);

test("the allowlist covers exactly the seven migrated domains", () => {
  assert.deepEqual(Object.keys(MIGRATED_BLOB_PATHS).sort(), [...DOMAINS].sort());
});

test("every path the migration reads from Blob (blobSource, nonces, fee locks) is purgeable", () => {
  for (const p of [
    "rewards/registry.json", "rewards/payout-day.json", `rewards/ledger/${M}.json`,
    `portfolio/trades/${W}.json`, `portfolio/backfill/${W}.json`,
    "activity/journal/2026-09-26.json", "economy/daily/2026-09-26.json", "economy/total.json",
    "protocol/pause.json", "audit/events/2026-09-26/abc.json", `auth/nonces/${"a".repeat(32)}.json`, "launch/pending-fee-lock.json",
  ]) assert.equal(isMigratedBlobPath(p), true, p);
  // ...and the source file really uses those prefixes (a new path there must be added to the allowlist)
  const source = readFileSync(path.join(process.cwd(), "src", "lib", "db", "source.ts"), "utf8");
  for (const lit of source.matchAll(/["'`]((?:rewards|portfolio|activity|economy|protocol|audit|launch)\/[A-Za-z0-9_./${}-]*)/g)) {
    const example = lit[1].replace(/\$\{[^}]*\}/g, "x");
    assert.equal(isMigratedBlobPath(example.endsWith("/") ? `${example}file.json` : example), true, `source.ts reads ${lit[1]} but the purge allowlist doesn't cover it`);
  }
});

test("images, metadata and every feature that is NOT in Postgres are never purgeable", () => {
  for (const p of [
    "panda/1750000000000-image-Ab3dE6gH.png", "panda/1750000000000-metadata-Ab3dE6gH.json",
    "nft/images/abc.png", "nft/metadata/abc.json", "nft/records/1.json", "nft/dedupe-index.json", "themes/index.json", "branches/index.json",
    "market/listings/1.json", "points/totals/1.json", "airdrop/allocations/1.json", "abuse/status/x.json", "otc/launches/x.json", "strategy/x.json",
    // look-alikes and tricks
    "rewards/registry.json.bak", "rewards/ledger", "rewards", "audit/events", "protocol/pause.json/x", "rewards/../nft/images/a.png", "/rewards/registry.json", "auth/other.json", "portfolio/other/x.json", "economy/other.json", "launch/other.json",
    "", "rewards/ledger/",
  ]) assert.equal(isMigratedBlobPath(p), false, p);
});

const blob = (pathname: string, daysAgo: number, now: number, size = 100): BlobMeta => ({ pathname, url: `https://x.invalid/${pathname}`, size, uploadedAt: new Date(now - daysAgo * 86_400_000) });

test("planPurge: deletes only allowlisted files; the retention clock starts at the NEWEST frozen write", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  const list = [blob("rewards/registry.json", 40, now), blob("audit/events/d/1.json", 35, now), blob("panda/img.png", 1, now, 5000)];
  const plan = planPurge(list, now, 30);
  assert.deepEqual(plan.toDelete.map((b) => b.pathname), ["rewards/registry.json", "audit/events/d/1.json"]);
  assert.deepEqual(plan.ignored.map((b) => b.pathname), ["panda/img.png"]);
  assert.equal(plan.bytes, 200);
  assert.equal(plan.tooFresh, false);
  const fresh = planPurge([blob("rewards/registry.json", 40, now), blob("audit/events/d/1.json", 10, now)], now, 30);
  assert.equal(fresh.tooFresh, true, "one file written 10 days ago keeps the whole purge waiting");
  assert.equal(fresh.allowedFrom, "2026-11-21");
  assert.equal(planPurge([], now, 30).tooFresh, false);
});

test("the purge script is a dry run by default, and gated on postgres mode, compare and the chain", () => {
  const script = readFileSync(path.join(process.cwd(), "scripts", "blob-purge.ts"), "utf8");
  assert.match(script, /const yes = process\.argv\.includes\("--yes"\) \|\| process\.env\.PANDA_BUILD_PURGE === "yes"/);
  assert.match(script, /not in "postgres" mode/);
  assert.match(script, /db:compare found/);
  assert.match(script, /pgVerifyChain/);
  assert.match(script, /retention period isn't over/);
  // the only delete call sits after the dry-run exit
  assert.ok(script.indexOf("await del(") > script.indexOf("DRY RUN OK"));
});
