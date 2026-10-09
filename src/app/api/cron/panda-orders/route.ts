import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { checkActive } from "@/lib/protocol/pause-store";
import { hasOrdersKey } from "@/lib/panda-orders/crypto";
import { realWatchDeps } from "@/lib/panda-orders/deps";
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
  return NextResponse.json(report);
}
