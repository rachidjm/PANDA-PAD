/**
 * Concurrency against a REAL Postgres with several connections. Skipped unless TEST_DATABASE_URL is set.
 *
 * The other database tests run on PGlite, whose single connection serializes transactions: they prove the logic and the constraints
 * but cannot show row-lock races between separate connections. This file does, so run it once against a THROWAWAY database
 * (a Neon branch you delete afterwards) — never production:
 *
 *   npm run db:migrate            (with DATABASE_URL_UNPOOLED pointing at that throwaway database)
 *   TEST_DATABASE_URL=postgresql://… npm test
 *
 * It only creates rows under random coin ids and deletes them afterwards. With TEST_DATABASE_SCHEMA it works inside that schema of the database
 * (scripts/verify-services.ts creates a throwaway schema, runs this file in it and drops it: that is how it runs on Vercel's build).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import type { Db } from "./client";
import { schema, rewardBalances, rewardClaims, rewardCredits, rewardDistributions, rewardLedgers, payoutDays } from "./schema";
import { pgCreditHolders, pgGetLedger, pgReserveClaim, pgReserveDailyPayout } from "./rewards";

const url = process.env.TEST_DATABASE_URL?.trim();
const skip = url ? false : "set TEST_DATABASE_URL (a throwaway Postgres with the migrations applied) to run the multi-connection concurrency tests";

const pools: Pool[] = [];
const real = (): Db => {
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url, max: 12 });
  pools.push(pool);
  // Optional: run inside a throwaway schema of that database (scripts/verify-services.ts creates and drops one). Needs a DIRECT
  // (unpooled) connection string, because a transaction pooler doesn't keep session settings.
  const testSchema = process.env.TEST_DATABASE_SCHEMA?.trim();
  if (testSchema) {
    if (!/^[a-z0-9_]+$/.test(testSchema)) throw new Error("TEST_DATABASE_SCHEMA must be lowercase letters, digits and underscores");
    pool.on("connect", (client: PoolClient) => void client.query(`set search_path to ${testSchema}`));
  }
  return drizzle(pool, { schema }) as unknown as Db;
};
after(async () => {
  await Promise.all(pools.map((p) => p.end()));
});

const rand = () => randomBytes(20).toString("hex");

test("REAL POSTGRES: 40 simultaneous claims over 12 connections pay out exactly the balance", { skip }, async () => {
  const db = real();
  const mint = "CONC" + rand(), holder = "HOLD" + rand(), sig = "SIG" + rand();
  try {
    await pgCreditHolders(db, { mint, sourceSig: sig, distributedLamports: 1_000_000, credits: [{ address: holder, lamports: 1_000_000 }], dustLamports: 0 });
    const results = await Promise.all(Array.from({ length: 40 }, () => pgReserveClaim(db, mint, holder, 100_000)));
    assert.equal(results.reduce((s, r) => s + r.amount, 0), 1_000_000);
    assert.equal(results.filter((r) => r.amount > 0).length, 10);
    assert.equal((await pgGetLedger(db, mint)).holders[holder].claimedLamports, 1_000_000);
  } finally {
    await db.delete(rewardClaims).where(eq(rewardClaims.mint, mint));
    await db.delete(rewardBalances).where(eq(rewardBalances.mint, mint));
    await db.delete(rewardCredits).where(eq(rewardCredits.mint, mint));
    await db.delete(rewardDistributions).where(eq(rewardDistributions.mint, mint));
    await db.delete(rewardLedgers).where(eq(rewardLedgers.mint, mint));
  }
});

test("REAL POSTGRES: the same distribution submitted by 20 simultaneous cron runs is booked once", { skip }, async () => {
  const db = real();
  const mint = "DIST" + rand(), holder = "HOLD" + rand(), sig = "SIG" + rand();
  try {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => pgCreditHolders(db, { mint, sourceSig: sig, distributedLamports: 500, credits: [{ address: holder, lamports: 500 }], dustLamports: 0 })));
    assert.equal(results.filter((r) => r.status === "fulfilled" && r.value === "applied").length, 1);
    assert.equal((await pgGetLedger(db, mint)).totalDistributedLamports, 500);
  } finally {
    await db.delete(rewardBalances).where(eq(rewardBalances.mint, mint));
    await db.delete(rewardCredits).where(eq(rewardCredits.mint, mint));
    await db.delete(rewardDistributions).where(eq(rewardDistributions.mint, mint));
    await db.delete(rewardLedgers).where(eq(rewardLedgers.mint, mint));
  }
});

test("REAL POSTGRES: the daily payout cap holds across connections", { skip }, async () => {
  const db = real();
  const day = "2099-" + String(1 + (Math.floor(Math.random() * 11))).padStart(2, "0") + "-" + String(1 + Math.floor(Math.random() * 27)).padStart(2, "0");
  try {
    const results = await Promise.all(Array.from({ length: 60 }, () => pgReserveDailyPayout(db, day, 10, 200)));
    assert.equal(results.filter(Boolean).length, 20);
  } finally {
    await db.delete(payoutDays).where(eq(payoutDays.day, day));
  }
});
