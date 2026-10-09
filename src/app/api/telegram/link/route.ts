import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sameOrigin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { tgEnqueue, tgGetUser } from "@/lib/db/telegram";
import { telegramConfig } from "@/lib/telegram/config";
import { completeLink } from "@/lib/telegram/link";
import { realQueueDeps } from "@/lib/telegram/deps";
import { processOutbox } from "@/lib/telegram/queue";
import { shortAddr, tt } from "@/lib/telegram/text";

const STATUS = { invalid: 400, code_used_or_expired: 410, bad_signature: 401, linked_elsewhere: 409 } as const;

/**
 * Public (the /link code + the wallet's signature are the credentials). Body: { code, wallet, signature, replace }.
 * Links the wallet to the Telegram account that asked for the code — once. A wallet linked to ANOTHER Telegram account answers
 * 409 until the user signs again with replace=true; that account is then told it lost the link.
 */
export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg.enabled) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`tg-link:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { code?: unknown; wallet?: unknown; signature?: unknown; replace?: unknown } | null;
  const db = getDb();
  const now = Date.now();
  const r = await completeLink(db, { code: body?.code, wallet: body?.wallet, signature: body?.signature, replace: body?.replace === true, domain: cfg.domain, now });
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.error }, { status: STATUS[r.error] });

  await recordAudit({ req, actor: r.wallet, action: "telegram.link", object: String(r.telegramId), newState: { replaced: r.previousTelegramId !== null } });
  const user = await tgGetUser(db, r.telegramId);
  const lang = user?.lang === "es" ? "es" : "en";
  await tgEnqueue(db, { chatId: String(r.telegramId), method: "sendMessage", payload: { text: tt(lang, "linkDone", { wallet: shortAddr(r.wallet) }) } }, now);
  if (r.previousTelegramId !== null) {
    const prev = await tgGetUser(db, r.previousTelegramId);
    await tgEnqueue(db, { chatId: String(r.previousTelegramId), method: "sendMessage", payload: { text: tt(prev?.lang === "es" ? "es" : "en", "linkMovedAway", { wallet: shortAddr(r.wallet) }) } }, now);
  }
  if (cfg.hasToken) await processOutbox(realQueueDeps(), 3_000).catch(() => undefined);
  return NextResponse.json({ ok: true, replaced: r.previousTelegramId !== null });
}
