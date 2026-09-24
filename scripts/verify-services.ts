/**
 * verify-services — checks the REAL Upstash and Neon services from wherever the environment variables live (in practice: the Vercel
 * build, because Vercel never hands "Sensitive" variables to a laptop). It prints results only — timings, counts, yes/no —
 * never a URL, token or password. Nothing it writes outlives it: Redis keys expire in seconds and the Postgres check works in a
 * throwaway schema that is dropped at the end. It signs and sends no transaction.
 *
 *   npm run verify-services
 *
 * What it proves (and the local tests could not): Upstash's happy path and the exact duration format the real SDK accepts, the added
 * latency per request; Neon over the app's own pooled connection (WebSocket driver, interactive transaction with a row lock, advisory
 * lock) and its latency; and the multi-connection concurrency tests (25–40 simultaneous claims/bookings over 12 real connections).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { getRedis, rateVerdict, setRateBackendForTests } from "../src/lib/rate-limit";
import { recordViolations, topViolations } from "../src/lib/security/csp-store";

let failures = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const stats = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  return `min ${s[0].toFixed(0)} / median ${s[Math.floor(s.length / 2)].toFixed(0)} / p95 ${s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(0)} / max ${s[s.length - 1].toFixed(0)} ms (n=${s.length})`;
};
const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const v = await fn();
  return [v, performance.now() - t];
};

async function upstash() {
  console.log("\n── Upstash (rate limiting) ──");
  setRateBackendForTests(undefined);
  const redis = getRedis();
  if (!redis) return ok(false, "Upstash credentials present (UPSTASH_REDIS_REST_* or KV_REST_API_*)");
  ok(true, "Upstash credentials present");
  const [pong] = await timed(() => redis.ping());
  ok(pong === "PONG", "PING");
  const pings: number[] = [];
  for (let i = 0; i < 15; i++) pings.push((await timed(() => redis.ping()))[1]);
  console.log(`     raw round trip: ${stats(pings)}`);

  // The real limiter (the SDK's sliding window with the "<n> ms" duration format the app uses), through the app's own code path.
  const key = `verify:${randomBytes(6).toString("hex")}`;
  const verdicts: string[] = [];
  const lat: number[] = [];
  for (let i = 0; i < 6; i++) {
    const [v, ms] = await timed(() => rateVerdict(key, 4, 10_000, "money"));
    verdicts.push(v);
    lat.push(ms);
  }
  ok(verdicts.slice(0, 4).every((v) => v === "ok") && verdicts.slice(4).every((v) => v === "limited"), "sliding window: 4 allowed, the next 2 limited", verdicts.join(","));
  console.log(`     added latency per rate-limited request (first call includes cold start): ${stats(lat)}`);
  const warm: number[] = [];
  for (let i = 0; i < 20; i++) warm.push((await timed(() => rateVerdict(`verify:${randomBytes(6).toString("hex")}`, 100, 10_000, "money")))[1]);
  console.log(`     warm, distinct keys: ${stats(warm)}`);
  const parallel = await Promise.all(Array.from({ length: 30 }, () => rateVerdict(`verify:shared:${key}`, 10, 10_000, "money")));
  // CSP report aggregation (the report-only period's storage): write a synthetic violation, read it back, remove it.
  const probe = { directive: "verify-probe", blocked: `https://verify-${randomBytes(3).toString("hex")}.invalid`, page: "/verify", source: "" };
  await recordViolations([probe]);
  const seen = (await topViolations(500)).some((r) => r.blocked === probe.blocked && r.count >= 1);
  await redis.hdel("panda:csp:v1:counts", `${probe.directive}|${probe.blocked}|${probe.page}|${probe.source}`);
  ok(seen, "CSP report aggregation stores and reads back a violation (then removed)");
  ok(parallel.filter((v) => v === "ok").length === 10, "30 simultaneous requests on one key: exactly 10 allowed (the counter is shared and atomic)", `${parallel.filter((v) => v === "ok").length} ok`);
}

async function neon() {
  console.log("\n── Neon (Postgres) ──");
  const pooled = process.env.DATABASE_URL?.trim();
  const direct = process.env.DATABASE_URL_UNPOOLED?.trim();
  ok(!!pooled, "DATABASE_URL present");
  ok(!!direct, "DATABASE_URL_UNPOOLED present");
  if (!pooled || !direct) return;
  neonConfig.webSocketConstructor = ws;

  // 1. The app's own path: pooled connection string, WebSocket driver.
  const pool = new Pool({ connectionString: pooled, max: 5 });
  try {
    const [, first] = await timed(() => pool.query("select 1"));
    const pings: number[] = [];
    for (let i = 0; i < 15; i++) pings.push((await timed(() => pool.query("select 1")))[1]);
    ok(true, "pooled connection answers (WebSocket driver)", `first query ${first.toFixed(0)} ms; ${stats(pings)}`);
    const region = await pool.query("select current_setting('server_version') as v");
    console.log(`     server ${region.rows[0].v}`);

    // Interactive transaction with a row lock and an advisory lock over the POOLED endpoint (what claims do).
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("create temp table probe (id int primary key, n int)");
      await c.query("insert into probe values (1, 0)");
      await c.query("select pg_advisory_xact_lock(hashtext('panda-verify'))");
      const locked = await c.query("select * from probe where id = 1 for update");
      await c.query("update probe set n = n + 1 where id = 1");
      const after = await c.query("select n from probe where id = 1");
      await c.query("rollback");
      ok(locked.rowCount === 1 && after.rows[0].n === 1, "interactive transaction with FOR UPDATE + advisory lock over the pooled URL");
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }

  // 2. Migrations + multi-connection concurrency in a throwaway schema, over the DIRECT connection.
  const schema = `verify_${randomBytes(5).toString("hex")}`;
  const admin = new Pool({ connectionString: direct, max: 1 });
  try {
    await admin.query(`create schema ${schema}`);
    const files = readdirSync(path.join(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).sort();
    const c = await admin.connect();
    try {
      await c.query(`set search_path to ${schema}`);
      for (const f of files) {
        const sqlFile = readFileSync(path.join(process.cwd(), "drizzle", f), "utf8");
        for (const stmt of sqlFile.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) await c.query(stmt);
      }
    } finally {
      c.release();
    }
    ok(true, `all ${files.length} migration files apply on real Postgres (throwaway schema ${schema})`);
    const run = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", "src/lib/db/concurrency.real.test.ts"], {
      env: { ...process.env, TEST_DATABASE_URL: direct, TEST_DATABASE_SCHEMA: schema },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = `${run.stdout}\n${run.stderr}`;
    const pass = Number(/# pass (\d+)/.exec(out)?.[1] ?? 0);
    const fail = Number(/# fail (\d+)/.exec(out)?.[1] ?? 1);
    ok(run.status === 0 && fail === 0 && pass >= 3, "multi-connection concurrency tests (concurrency.real.test.ts)", `${pass} passed, ${fail} failed`);
    if (run.status !== 0 || pass < 3) console.log(out.split("\n").filter((l) => !/postgres(ql)?:\/\//i.test(l)).slice(0, 60).join("\n"));
  } finally {
    await admin.query(`drop schema if exists ${schema} cascade`).catch((e) => console.log("     could not drop the throwaway schema:", (e as Error).message));
    await admin.end();
  }
}

async function main() {
  await upstash().catch((e) => ok(false, "Upstash checks ran", (e as Error).message));
  await neon().catch((e) => ok(false, "Neon checks ran", (e as Error).message));
  console.log(failures === 0 ? "\nVERIFY OK" : `\nVERIFY FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
