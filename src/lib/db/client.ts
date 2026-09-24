import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase } from "drizzle-orm/pg-core";
import ws from "ws";
import { schema } from "./schema";

/**
 * The one place that opens a database connection. Server-only.
 *
 * Driver: Neon's serverless driver over WebSockets (`Pool`), NOT the HTTP one: claims need interactive transactions
 * (`SELECT … FOR UPDATE`, then update, then commit), which the HTTP driver can't do. On Vercel, connect the Neon integration and
 * use its POOLED connection string as DATABASE_URL (sin verificar: the exact variable names the integration injects).
 *
 * Tests inject an in-process Postgres (PGlite) through `setDbForTests`; nothing else in the app knows which driver is behind `Db`.
 */

// The repositories only use what every Postgres driver in Drizzle has (query builder + transactions).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export class DbNotConfiguredError extends Error {
  constructor() {
    super("Postgres isn't configured — set DATABASE_URL.");
  }
}

export const databaseUrl = (env: Record<string, string | undefined> = process.env): string | null => env.DATABASE_URL?.trim() || null;

let testDb: Db | null = null;
export function setDbForTests(db: Db | null): void {
  testDb = db;
}

const globalForDb = globalThis as unknown as { __pandaPool?: Pool; __pandaDb?: Db };

/** Throws DbNotConfiguredError when there is no DATABASE_URL: a domain in "postgres" mode then fails closed instead of silently using Blob. */
export function getDb(): Db {
  if (testDb) return testDb;
  if (globalForDb.__pandaDb) return globalForDb.__pandaDb;
  const url = databaseUrl();
  if (!url) throw new DbNotConfiguredError();
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
  pool.on("error", (err: Error) => console.error("[PANDA db] idle client error", err.message));
  globalForDb.__pandaPool = pool;
  globalForDb.__pandaDb = drizzle(pool, { schema }) as unknown as Db;
  return globalForDb.__pandaDb;
}

/** A cheap round trip, for the health check. */
export async function pingDb(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await getDb().execute(sql`select 1`);
}

/**
 * A deeper health probe over the app's own connection: latency, an interactive transaction with a row lock (what claims do), and whether
 * the migrations have created the schema. Reads only; the transaction is rolled back.
 */
export async function probeDb(): Promise<{ ms: number; transactionOk: boolean; schemaApplied: boolean }> {
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  const t0 = performance.now();
  await db.execute(sql`select 1`);
  const ms = Math.round(performance.now() - t0);
  let transactionOk = false;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('panda-health'))`);
      transactionOk = true;
    });
  } catch {
    transactionOk = false;
  }
  let schemaApplied = false;
  try {
    const r = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_name in ('reward_balances','reward_claims','trades','activity_events','protocol_pause')`);
    const rows = (r as unknown as { rows?: { n: number }[] }).rows ?? (r as unknown as { n: number }[]);
    schemaApplied = Number(rows[0]?.n) === 5;
  } catch {
    schemaApplied = false;
  }
  return { ms, transactionOk, schemaApplied };
}
