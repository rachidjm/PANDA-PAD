import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { sameOrigin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";
import { checkActive } from "@/lib/protocol/pause-store";
import { tgEnqueue, tgListChangelogs, tgListSuggestions, tgOutboxCounts, tgStats } from "@/lib/db/telegram";
import { makeTelegramCall } from "@/lib/telegram/api";
import { telegramConfig } from "@/lib/telegram/config";
import { buildAnnouncement } from "@/lib/telegram/feeds";
import { realQueueDeps } from "@/lib/telegram/deps";
import { processOutbox } from "@/lib/telegram/queue";

/** The commands shown in Telegram's menu (admin commands are never listed). */
const COMMANDS = {
  en: [
    ["new", "Latest coins launched on PANDA"],
    ["trending", "Most traded coins (24h volume)"],
    ["token", "A coin's price, market cap, liquidity"],
    ["watchlist", "Your watchlist"],
    ["watch", "Add a coin to your watchlist"],
    ["unwatch", "Remove a coin from your watchlist"],
    ["alert", "A one-time price or market-cap alert"],
    ["alerts", "Your alerts"],
    ["link", "Link your wallet"],
    ["unlink", "Unlink your wallet"],
    ["suggest", "Send the team an idea"],
    ["help", "What the bot can do"],
  ],
  es: [
    ["new", "Últimas monedas lanzadas en PANDA"],
    ["trending", "Monedas más operadas (volumen 24 h)"],
    ["token", "Precio, cap. de mercado y liquidez"],
    ["watchlist", "Tu lista de seguimiento"],
    ["watch", "Añade una moneda a tu lista"],
    ["unwatch", "Quita una moneda de tu lista"],
    ["alert", "Una alerta de precio o cap. de mercado"],
    ["alerts", "Tus alertas"],
    ["link", "Vincula tu wallet"],
    ["unlink", "Desvincula tu wallet"],
    ["suggest", "Envía una idea al equipo"],
    ["help", "Lo que puede hacer el bot"],
  ],
} as const;

/**
 * Auth: admin (requireAdmin: a listed wallet that signed in recently). The bot's status, and its few admin actions — every one
 * audited. The token never leaves the server: Telegram is called from here, and nothing that contains it is returned.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const cfg = telegramConfig();
  const call = makeTelegramCall();
  const [webhook, me, paused] = await Promise.all([
    cfg.hasToken ? call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>("getWebhookInfo", {}) : null,
    cfg.hasToken ? call<{ username: string }>("getMe", {}) : null,
    checkActive("telegram"),
  ]);
  let db: Awaited<ReturnType<typeof dbData>> | { error: string };
  try {
    db = await dbData();
  } catch {
    db = { error: "The database isn't reachable (or the Telegram tables aren't migrated yet)." };
  }
  return NextResponse.json(
    {
      enabled: cfg.enabled,
      changelogEnabled: cfg.changelogEnabled,
      hasChangelogSecret: !!cfg.changelogSecret,
      hasToken: cfg.hasToken,
      hasSecret: !!cfg.webhookSecret,
      botUsername: cfg.botUsername,
      botUsernameFromTelegram: me?.ok ? me.result?.username : null,
      channelId: cfg.channelId,
      groupId: cfg.groupId,
      groupUrl: cfg.groupUrl,
      channelUrl: cfg.channelUrl,
      topics: cfg.topics,
      adminIds: cfg.adminIds.size,
      minBuyUsd: cfg.minBuyUsd,
      paused: paused.paused,
      webhook: webhook?.ok ? { url: webhook.result?.url ?? "", pending: webhook.result?.pending_update_count ?? 0, lastError: webhook.result?.last_error_message ?? null, lastErrorAt: webhook.result?.last_error_date ?? null } : webhook ? { error: webhook.description ?? "unreachable" } : null,
      ...db,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function dbData() {
  const d = getDb();
  const [stats, outbox, suggestions, changelogs] = await Promise.all([tgStats(d), tgOutboxCounts(d), tgListSuggestions(d, 50), tgListChangelogs(d, 20)]);
  return { stats, outbox, suggestions, changelogs };
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const cfg = telegramConfig();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const call = makeTelegramCall();
  const audit = (object: string, newState?: Record<string, unknown>) => recordAudit({ req, actor: admin.wallet, action: `admin.telegram.${String(action)}`, object, ...(newState ? { newState } : {}) });

  if (action === "announce_preview" || action === "announce") {
    if (!cfg.channelId) return NextResponse.json({ error: "TELEGRAM_CHANNEL_ID isn't set." }, { status: 409 });
    const built = buildAnnouncement({ text: String(body?.text ?? ""), imageUrl: body?.imageUrl ? String(body.imageUrl) : undefined, buttonText: body?.buttonText ? String(body.buttonText) : undefined, buttonUrl: body?.buttonUrl ? String(body.buttonUrl) : undefined }, cfg.channelId, cfg.groupUrl);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    if (action === "announce_preview") return NextResponse.json({ ok: true, preview: built.message });
    if (!cfg.enabled || !cfg.hasToken) return NextResponse.json({ error: "The bot is off (FEATURE_TELEGRAM_BOT / TELEGRAM_BOT_TOKEN)." }, { status: 409 });
    if ((await checkActive("telegram")).paused) return NextResponse.json({ error: "The Telegram bot is paused." }, { status: 409 });
    const id = await tgEnqueue(getDb(), { ...built.message, dedupeKey: `announce:${randomUUID()}` }, Date.now());
    await audit(cfg.channelId, { outboxId: id, chars: String(body?.text ?? "").length, image: !!body?.imageUrl, button: !!body?.buttonUrl });
    const sent = await processOutbox(realQueueDeps(), 5_000);
    return NextResponse.json({ ok: true, queued: id, sent: sent.sent > 0 });
  }

  if (!cfg.hasToken) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN isn't set." }, { status: 409 });

  if (action === "set_webhook") {
    if (!cfg.enabled) return NextResponse.json({ error: "Switch FEATURE_TELEGRAM_BOT on first (the webhook answers 404 while it's off)." }, { status: 409 });
    if (!cfg.webhookSecret) return NextResponse.json({ error: "TELEGRAM_WEBHOOK_SECRET isn't set (or is too short)." }, { status: 409 });
    const url = `${cfg.siteUrl}/api/telegram/webhook`;
    const r = await call("setWebhook", { url, secret_token: cfg.webhookSecret, allowed_updates: ["message", "callback_query"], max_connections: 20, drop_pending_updates: false });
    await audit(url, { ok: r.ok });
    return r.ok ? NextResponse.json({ ok: true, url }) : NextResponse.json({ error: r.description ?? "Telegram refused it." }, { status: 502 });
  }
  if (action === "delete_webhook") {
    const r = await call("deleteWebhook", { drop_pending_updates: false });
    await audit("webhook", { ok: r.ok });
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.description ?? "Telegram refused it." }, { status: 502 });
  }
  if (action === "set_commands") {
    const en = await call("setMyCommands", { commands: COMMANDS.en.map(([command, description]) => ({ command, description })) });
    const es = await call("setMyCommands", { commands: COMMANDS.es.map(([command, description]) => ({ command, description })), language_code: "es" });
    await audit("commands", { en: en.ok, es: es.ok });
    return en.ok && es.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: en.description ?? es.description ?? "Telegram refused it." }, { status: 502 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
