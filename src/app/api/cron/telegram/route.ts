import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { checkActive } from "@/lib/protocol/pause-store";
import { tgCleanup, tgGetState, tgSetState } from "@/lib/db/telegram";
import { telegramConfig } from "@/lib/telegram/config";
import { evaluateAlerts } from "@/lib/telegram/alerts";
import { postNewLaunches, postPandaBuys, postPayoutDigest } from "@/lib/telegram/feeds";
import { realFeedDeps, realMarket, realQueueDeps } from "@/lib/telegram/deps";
import { processOutbox } from "@/lib/telegram/queue";

export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unguarded
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Every minute (vercel.json): the automatic posts (new PANDA launches, $PANDA buys, the hourly payout digest), the personal
 * alerts, then the outbox. Switched off / no token / paused → returns at once, costs nothing. Each step is independent: one
 * failing (an upstream API down) never stops the others, and none of this is on any path a PANDA user waits on.
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return new NextResponse(null, { status: 404 });
  const cfg = telegramConfig();
  if (!cfg.enabled) return NextResponse.json({ skipped: "flag off" });
  if (!cfg.hasToken) return NextResponse.json({ skipped: "TELEGRAM_BOT_TOKEN not set" });
  if ((await checkActive("telegram")).paused) return NextResponse.json({ skipped: "telegram is paused" });

  const report: Record<string, unknown> = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      report[name] = await fn();
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.name : "error"}`);
    }
  };
  const feeds = realFeedDeps();
  await step("launches", () => postNewLaunches(feeds));
  await step("buys", () => postPandaBuys(feeds));
  await step("payouts", () => postPayoutDigest(feeds));
  await step("alerts", () => evaluateAlerts({ db: getDb(), market: realMarket, now: Date.now }));
  await step("outbox", () => processOutbox(realQueueDeps(), 40_000));
  await step("cleanup", async () => {
    const db = getDb();
    const last = (await tgGetState<number>(db, "cleanup.at")) ?? 0;
    if (Date.now() - last < 86_400_000) return "not due";
    await tgCleanup(db, Date.now());
    await tgSetState(db, "cleanup.at", Date.now(), Date.now());
    return "done";
  });
  if (errors.length) console.warn("[PANDA telegram] cron step errors", errors);
  return NextResponse.json({ ...report, errors });
}
