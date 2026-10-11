import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sameOrigin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { tgEnqueue, tgGetLinkCode, tgGetUser } from "@/lib/db/telegram";
import { telegramConfig } from "@/lib/telegram/config";
import { completeLink, hashLinkCode, isLinkCode } from "@/lib/telegram/link";
import { linkCodeState } from "@/lib/telegram/link-page";
import { realQueueDeps } from "@/lib/telegram/deps";
import { processOutbox } from "@/lib/telegram/queue";
import { shortAddr, tt } from "@/lib/telegram/text";

/**
 * ?code=<the one-time code>: whether that link can still be used — "ok", "expired" (used, or too old) or "invalid".
 * Public and read-only: it tells the page what to show before anyone opens their wallet. It says nothing about whose
 * code it is, and a code can only be guessed by someone who already has it (144 random bits).
 */
export async function GET(req: Request) {
  const cfg = telegramConfig();
  if (!cfg.enabled) return new NextResponse(null, { status: 404 });
  if (await rateLimited(`tg-link-state:ip:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const code = new URL(req.url).searchParams.get("code");
  const headers = { "Cache-Control": "no-store" };
  if (!isLinkCode(code)) return NextResponse.json({ state: "invalid" }, { headers });
  const rec = await tgGetLinkCode(getDb(), hashLinkCode(code));
  return NextResponse.json({ state: linkCodeState(rec, Date.now()) }, { headers });
}

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
