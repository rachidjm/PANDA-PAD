import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes the next numbered SQL migration into ./drizzle from the schema; it needs no database.
// `npm run db:migrate` (scripts/db-migrate.ts) applies them to the database in DATABASE_URL_UNPOOLED / DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
