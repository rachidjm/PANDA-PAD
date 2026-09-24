/**
 * vercel-build — what Vercel runs instead of `next build` (an npm script named "vercel-build" takes precedence).
 *
 * 1. PRODUCTION builds apply the database migrations first (idempotent; needs DATABASE_URL_UNPOOLED or DATABASE_URL). If the
 *    migration fails the build fails and the previous deployment keeps serving: a schema problem never reaches users.
 * 2. Optional one-off tasks, only when PANDA_BUILD_TASKS is set for THAT deployment (`vercel deploy --build-env PANDA_BUILD_TASKS=…`,
 *    never stored in the project): they run where the "Sensitive" variables exist and print to the build log, which is how they are
 *    read. Tasks: verify-services, compare, backfill (add PANDA_BUILD_BACKFILL=yes to really write; otherwise a dry run).
 *    A failing task is reported but does not block the deployment of the same code.
 * 3. `next build`.
 */
import { spawnSync } from "node:child_process";

const run = (label: string, args: string[], fatal: boolean): boolean => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  const ok = r.status === 0;
  if (!ok) {
    console.log(`=== ${label}: ${fatal ? "FAILED — stopping the build" : "reported FAILURES (build continues)"} ===`);
    if (fatal) process.exit(r.status ?? 1);
  }
  return ok;
};

const tsx = (script: string, ...extra: string[]) => ["--import", "tsx", script, ...extra];

const production = process.env.VERCEL_ENV === "production";
const hasDb = !!(process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim());

if (production && hasDb) run("database migrations", tsx("scripts/db-migrate.ts"), true);
else console.log(`(skipping database migrations: ${production ? "no database configured" : "not a production build"})`);

const tasks = (process.env.PANDA_BUILD_TASKS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
for (const t of tasks) {
  if (t === "verify-services") run("verify-services", tsx("scripts/verify-services.ts"), false);
  else if (t === "compare") run("db:compare", tsx("scripts/db-compare.ts", ...(process.env.PANDA_BUILD_DOMAINS ? ["--domains", process.env.PANDA_BUILD_DOMAINS] : [])), false);
  else if (t === "backfill") {
    const args = ["--domains", process.env.PANDA_BUILD_DOMAINS || "pause,trades,activity,rewards"];
    if (process.env.PANDA_BUILD_BACKFILL === "yes") args.push("--yes");
    run(`db:backfill${process.env.PANDA_BUILD_BACKFILL === "yes" ? " --yes" : " (dry run)"}`, tsx("scripts/db-backfill.ts", ...args), false);
  } else console.log(`(unknown build task "${t}" ignored)`);
}

run("next build", ["node_modules/next/dist/bin/next", "build"], true);
