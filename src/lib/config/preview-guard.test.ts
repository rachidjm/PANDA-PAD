import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blobToken, fingerprint, fingerprintsLine, previewMayUse, productionFingerprints, serviceFingerprint, serviceId } from "./preview-guard";
import { databaseUrl } from "../db/client";
import { upstashCredentials } from "../rate-limit";
import { isEnabled, NEVER_IN_PREVIEW } from "./flags";

const PROD_DB = "postgresql://user:secret@ep-main-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const PROD_DB_DIRECT = "postgresql://user:secret@ep-main-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const BRANCH_DB = "postgresql://user:other@ep-preview-987654-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const PROD_REDIS = "https://prod-redis-1.upstash.io";
const OTHER_REDIS = "https://preview-redis-2.upstash.io";
const PROD_BLOB = "vercel_blob_rw_AbCdEf123_secretsecretsecret";
const OTHER_BLOB = "vercel_blob_rw_ZyXwVu987_othersecret";
const PRINTS = fingerprintsLine({ database: PROD_DB, redis: PROD_REDIS, blob: PROD_BLOB });
const preview = (extra: Record<string, string> = {}) => ({ VERCEL_ENV: "preview", PANDA_PRODUCTION_FINGERPRINTS: PRINTS, ...extra });

test("a service is known by its host or store id — never by a password or a token", () => {
  assert.equal(serviceId("database", PROD_DB), "ep-main-123456.eu-central-1.aws.neon.tech");
  // Pooled and direct addresses are the same database.
  assert.equal(serviceId("database", PROD_DB_DIRECT), serviceId("database", PROD_DB));
  assert.equal(serviceId("redis", PROD_REDIS), "prod-redis-1.upstash.io");
  assert.equal(serviceId("blob", PROD_BLOB), "abcdef123");
  assert.equal(serviceId("blob", "not-a-token"), null);
  assert.equal(serviceId("database", "not a url"), null);
  assert.match(fingerprint("x"), /^[0-9a-f]{16}$/);
  assert.notEqual(fingerprint("a"), fingerprint("b"));
  // The line a production build prints carries no secret.
  assert.match(PRINTS, /^database:[0-9a-f]{16},redis:[0-9a-f]{16},blob:[0-9a-f]{16}$/);
  for (const secret of ["secret", "ep-main", "upstash", "AbCdEf"]) assert.ok(!PRINTS.includes(secret));
  assert.deepEqual(Object.keys(productionFingerprints({ PANDA_PRODUCTION_FINGERPRINTS: PRINTS })).sort(), ["blob", "database", "redis"]);
  assert.deepEqual(productionFingerprints({ PANDA_PRODUCTION_FINGERPRINTS: "database:zz,other:0123456789abcdef" }), {});
});

test("production and local development are never restricted", () => {
  for (const env of [{ VERCEL_ENV: "production" }, { NODE_ENV: "development" }, {}]) {
    assert.equal(previewMayUse("database", PROD_DB, env), true);
    assert.equal(previewMayUse("redis", PROD_REDIS, env), true);
    assert.equal(previewMayUse("blob", PROD_BLOB, env), true);
  }
  assert.equal(databaseUrl({ VERCEL_ENV: "production", DATABASE_URL: PROD_DB }), PROD_DB);
});

test("a preview never uses production's database, Redis or Blob — even if their variables are shared with it again", () => {
  assert.equal(previewMayUse("database", PROD_DB, preview()), false);
  assert.equal(previewMayUse("database", PROD_DB_DIRECT, preview()), false);
  assert.equal(previewMayUse("redis", PROD_REDIS, preview()), false);
  assert.equal(previewMayUse("blob", PROD_BLOB, preview()), false);
  // …through the app's own readers:
  assert.equal(databaseUrl(preview({ DATABASE_URL: PROD_DB })), null);
  assert.equal(upstashCredentials(preview({ KV_REST_API_URL: PROD_REDIS, KV_REST_API_TOKEN: "t" })), null);
  assert.equal(blobToken(preview({ BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN: PROD_BLOB })), null);
});

test("a preview that can't know production's fingerprints uses nothing: it can't prove a service is another one", () => {
  const blind = { VERCEL_ENV: "preview" };
  assert.equal(previewMayUse("database", BRANCH_DB, blind), false);
  assert.equal(databaseUrl({ ...blind, DATABASE_URL: BRANCH_DB }), null);
  assert.equal(upstashCredentials({ ...blind, KV_REST_API_URL: OTHER_REDIS, KV_REST_API_TOKEN: "t" }), null);
  assert.equal(blobToken({ ...blind, BLOB_READ_WRITE_TOKEN: OTHER_BLOB }), null);
  // Unreadable values are not trusted either.
  assert.equal(previewMayUse("database", "garbage", preview()), false);
});

test("a preview uses services of its own: a Neon branch, another Redis, another Blob store", () => {
  assert.equal(databaseUrl(preview({ DATABASE_URL: BRANCH_DB })), BRANCH_DB);
  assert.deepEqual(upstashCredentials(preview({ KV_REST_API_URL: OTHER_REDIS, KV_REST_API_TOKEN: "t" })), { url: OTHER_REDIS, token: "t" });
  assert.equal(blobToken(preview({ BLOB_READ_WRITE_TOKEN: OTHER_BLOB })), OTHER_BLOB);
  assert.notEqual(serviceFingerprint("database", BRANCH_DB), serviceFingerprint("database", PROD_DB));
  // Nothing configured is simply nothing.
  assert.equal(databaseUrl(preview()), null);
  assert.equal(blobToken(preview()), null);
});

test("the build: a preview never migrates production, and never runs the one-off tasks", () => {
  const build = readFileSync("scripts/vercel-build.ts", "utf8");
  assert.match(build, /if \(production && hasDb\) run\("database migrations"/);
  assert.match(build, /else if \(preview && hasDb && previewMayUse\("database", migrationUrl\) && previewMayUse\("database", process\.env\.DATABASE_URL\)\)/);
  assert.match(build, /const tasks = preview \? \[\] :/);
  const migrate = readFileSync("scripts/db-migrate.ts", "utf8");
  assert.ok(migrate.indexOf("Refusing to migrate from a preview") < migrate.indexOf("await migrate("), "the refusal comes before anything is applied");
});

test("a preview never runs background work or speaks as PANDA, whatever its variables say", () => {
  for (const f of NEVER_IN_PREVIEW) {
    assert.equal(isEnabled(f, { VERCEL_ENV: "preview", [`FEATURE_${f}`]: "true" }), false, f);
    assert.equal(isEnabled(f, { VERCEL_ENV: "production", [`FEATURE_${f}`]: "true" }), true, f);
    assert.equal(isEnabled(f, { [`FEATURE_${f}`]: "true" }), true, f);
  }
  for (const f of ["HOLDER_REWARDS", "BURN", "PANDA_ORDERS", "TELEGRAM_BOT", "X_POSTING"] as const) assert.ok(NEVER_IN_PREVIEW.includes(f));
  // Other flags are untouched.
  assert.equal(isEnabled("REFERRALS", { VERCEL_ENV: "preview", FEATURE_REFERRALS: "true" }), true);
  // Every cron and the bot's webhook answer 404 in a preview before doing anything else.
  const routes = ["cron/burn", "cron/cleanup-auth", "cron/collect-fees", "cron/panda-orders", "cron/telegram", "cron/warm-coins", "telegram/webhook"];
  for (const r of routes) {
    const src = readFileSync(`src/app/api/${r}/route.ts`, "utf8");
    const body = src.slice(src.search(/export async function (GET|POST)\(req: Request\) \{/));
    assert.match(body.split("\n").slice(1, 3).join("\n"), /if \(isPreview\(\)\) return new NextResponse\(null, \{ status: 404 \}\);/, r);
  }
  // …and vercel.json schedules nothing that isn't one of them.
  const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string }[] }).crons.map((c) => c.path.replace("/api/", ""));
  for (const c of crons) assert.ok(routes.includes(c), c);
});
