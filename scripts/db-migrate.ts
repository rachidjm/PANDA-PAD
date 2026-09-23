/**
 * db-migrate — applies the numbered SQL migrations in ./drizzle to the Postgres in DATABASE_URL_UNPOOLED (or DATABASE_URL).
 *
 *   npm run db:migrate
 *
 * Safe to run again: applied migrations are recorded and skipped. It only ever CREATES/ALTERS the schema described in
 * src/lib/db/schema.ts; it deletes no data. Use Neon's UNPOOLED connection string for it (migrations don't like a transaction pooler).
 * The connection string is read from the environment (.env.local is loaded if present) and never printed.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) — e.g. `vercel env pull .env.local`.");
    process.exit(2);
  }
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("Migrations applied (or already up to date).");
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
