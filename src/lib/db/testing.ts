/**
 * TEST-ONLY helpers (never imported by app code): a real Postgres engine in-process (PGlite) with the real migrations applied,
 * so the repositories are tested against actual SQL — CHECK constraints, ON CONFLICT, FOR UPDATE, transactions.
 *
 * PGlite has ONE connection, so it serializes transactions: it proves the logic and the constraints but not row-lock races between
 * connections. That is what concurrency.real.test.ts is for (it runs only when TEST_DATABASE_URL points at a throwaway Postgres).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { schema } from "./schema";
import type { Db } from "./client";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export async function newTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Db;
}
