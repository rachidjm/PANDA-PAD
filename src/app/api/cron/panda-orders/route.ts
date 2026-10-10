import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { checkActive } from "@/lib/protocol/pause-store";
import { hasOrdersKey } from "@/lib/panda-orders/crypto";
import { realExecutionDeps, realWatchDeps } from "@/lib/panda-orders/deps";
import { logExecutions } from "@/lib/panda-orders/executions";
import { pgExecutedSince } from "@/lib/db/panda-orders";
import { getDb } from "@/lib/db/client";
import { runWatcher } from "@/lib/panda-orders/watcher";

// Every minute (vercel.json), watching for ~50 s: a sell or a stop is checked about every 1.5 s, not once a minute.
export const maxDuration = 60;
const BUDGET_MS = 50_000;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unguarded
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return new NextResponse(null, { status: 404 });
  // Switched off (the default): returns at once, costs nothing.
  if (!isEnabled("PANDA_ORDERS")) return NextResponse.json({ skipped: "flag off" });
  if (!hasOrdersKey()) return NextResponse.json({ skipped: "PANDA_ORDERS_KEY not set" });
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  if ((await checkActive("panda_orders")).paused) return NextResponse.json({ skipped: "panda_orders is paused" });
  const report = await runWatcher(realWatchDeps(), BUDGET_MS);
  if (report.errors.length) console.warn("[PANDA orders] watcher errors", report.errors.slice(0, 10));
  // What just executed goes into its wallet's trade log while the SOL price is still the one of that moment (so the
  // chart can mark it at its real price). Best effort: the wallet's own page does the same if this misses one.
  try {
    await logExecutions(realExecutionDeps(), await pgExecutedSince(getDb(), Date.now() - 30 * 60_000));
  } catch (err) {
    console.warn("[PANDA orders] logging executions failed", err instanceof Error ? err.name : "error");
  }
  return NextResponse.json(report);
}
