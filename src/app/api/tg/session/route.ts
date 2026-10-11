import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { tgGetUser, tgTouchUser } from "@/lib/db/telegram";
import { appSessionOf } from "@/lib/telegram/app-login";
import { issueSession, miniappEnabled, verifyInitData } from "@/lib/telegram/miniapp";
import { appGate, noStore } from "@/lib/telegram/miniapp-route";

/**
 * Body: { initData } — Telegram.WebApp.initData exactly as Telegram gave it. Its signature (HMAC with the bot's token)
 * and its age are checked here; only then is a session issued, for that Telegram account. The linked wallet comes from
 * PANDA's own records (/link), never from the request.
 */
export async function POST(req: Request) {
  if (!miniappEnabled()) return new NextResponse(null, { status: 404 });
  if (await rateLimited(`tg-app-session:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests.", code: "rate" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { initData?: unknown } | null;
  const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
  const now = Date.now();
  const v = verifyInitData(body?.initData, token, now);
  if (!v.ok) return NextResponse.json({ error: v.error === "expired" ? "This session expired — reopen the app from Telegram." : "Invalid Telegram data.", code: v.error }, { status: 401 });
  const user = await tgTouchUser(getDb(), v.user.id, v.user.lang, now);
  const session = issueSession(v.user.id, token, now);
  // PANDA's own session, if this account has a live one (it survives the app being reloaded): opening the app is a use.
  const app = user.wallet ? await appSessionOf({ db: getDb(), now: Date.now }, v.user.id).catch(() => null) : null;
  return NextResponse.json({ token: session.token, expiresAt: session.expiresAt, lang: v.user.lang, firstName: v.user.firstName, wallet: user.wallet ?? null, app: app ? { wallet: app.wallet, expiresAt: app.expiresAt } : null }, noStore);
}

/** Who this session is, read again (the wallet may have been linked meanwhile). */
export async function GET(req: Request) {
  const g = await appGate(req);
  if (g instanceof NextResponse) return g;
  const user = await tgGetUser(getDb(), g.telegramId);
  return NextResponse.json({ wallet: user?.wallet ?? null }, noStore);
}
