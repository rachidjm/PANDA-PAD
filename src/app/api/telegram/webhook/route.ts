import { NextResponse } from "next/server";
import { checkActive } from "@/lib/protocol/pause-store";
import { telegramConfig } from "@/lib/telegram/config";
import { handleUpdate, secretMatches } from "@/lib/telegram/bot";
import { MAX_BODY_BYTES } from "@/lib/telegram/updates";
import { realBotDeps, realQueueDeps } from "@/lib/telegram/deps";
import { processOutbox } from "@/lib/telegram/queue";

export const maxDuration = 30;

/**
 * Telegram's webhook (docs/TELEGRAM.md). Auth: the X-Telegram-Bot-Api-Secret-Token header must equal TELEGRAM_WEBHOOK_SECRET.
 * Off (flag, token or secret missing) → 404, as if it didn't exist. Paused → 200 and nothing done (Telegram doesn't re-send).
 * Every reply goes through the outbox, flushed for a few seconds here so answers are immediate; the cron retries the rest.
 */
export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg.enabled || !cfg.hasToken || !cfg.webhookSecret) return new NextResponse(null, { status: 404 });
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), cfg.webhookSecret)) return new NextResponse(null, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if ((await checkActive("telegram")).paused) return NextResponse.json({ ok: true });
  try {
    const outcome = await handleUpdate(realBotDeps(), json);
    if (outcome === "invalid") return new NextResponse(null, { status: 400 });
    if (outcome === "handled") await processOutbox(realQueueDeps(), 4_000);
  } catch (err) {
    // Never the update's content in the logs (it's a user's message): only that something failed.
    console.warn("[PANDA telegram] webhook update failed", err instanceof Error ? err.name : "error");
  }
  return NextResponse.json({ ok: true });
}
