import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { burnNonce, readNonce, sameOrigin, storeNonce } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { APP_SESSION_HEADER, closeAppLogin, completeAppLogin, resumeAppLogin, startAppLogin, type LoginDeps } from "@/lib/telegram/app-login";
import { miniappEnabled } from "@/lib/telegram/miniapp";
import { appGate, noStore } from "@/lib/telegram/miniapp-route";

/**
 * Signing in to PANDA inside the Mini App (src/lib/telegram/app-login.ts). Every step needs the Telegram session
 * (appGate); the wallet is always the one that account linked with /link, never one the request names.
 *   POST    the sign-in message for the linked wallet to sign.
 *   PUT     the signature: a session for the open app, returned in the answer (never a cookie).
 *   PATCH   back from the wallet after Telegram restarted the app: the one-time ticket returns the same session.
 *   DELETE  the app was closed: the session ends here too.
 */
const deps = (): LoginDeps => ({ db: getDb(), now: Date.now, botToken: process.env.TELEGRAM_BOT_TOKEN!.trim(), nonces: { store: storeNonce, read: readNonce, burn: burnNonce } });
const fail = (error: string, status: number) => NextResponse.json({ error, code: error }, { status, ...noStore });

export async function POST(req: Request) {
  const g = await appGate(req, 20, "login");
  if (g instanceof NextResponse) return g;
  const domain = req.headers.get("host");
  if (!domain || !sameOrigin(req)) return fail("invalid", 400);
  try {
    const r = await startAppLogin(deps(), g.telegramId, domain);
    return r.ok ? NextResponse.json(r, noStore) : fail(r.error, 409);
  } catch {
    return fail("unavailable", 503);
  }
}

export async function PUT(req: Request) {
  const g = await appGate(req, 20, "login");
  if (g instanceof NextResponse) return g;
  const domain = req.headers.get("host");
  if (!domain || !sameOrigin(req)) return fail("invalid", 400);
  const body = (await req.json().catch(() => null)) as { nonce?: unknown; signature?: unknown } | null;
  try {
    const r = await completeAppLogin(deps(), { telegramId: g.telegramId, nonce: body?.nonce, signature: body?.signature, domain });
    if (!r.ok) return fail(r.error, r.error === "not_linked" ? 409 : 401);
    await recordAudit({ req, actor: r.wallet, action: "auth.login", object: "session", newState: { jti: r.jti, via: "telegram-miniapp" } });
    return NextResponse.json(r, noStore);
  } catch {
    return fail("unavailable", 503);
  }
}

export async function PATCH(req: Request) {
  const g = await appGate(req, 20, "login");
  if (g instanceof NextResponse) return g;
  const body = (await req.json().catch(() => null)) as { jti?: unknown; resume?: unknown } | null;
  try {
    const r = await resumeAppLogin(deps(), { telegramId: g.telegramId, jti: body?.jti, resume: body?.resume });
    return r.ok ? NextResponse.json(r, noStore) : fail(r.error, 401);
  } catch {
    return fail("unavailable", 503);
  }
}

export async function DELETE(req: Request) {
  if (!miniappEnabled()) return new NextResponse(null, { status: 404 });
  try {
    const closed = await closeAppLogin(deps(), req.headers.get(APP_SESSION_HEADER));
    return NextResponse.json({ ok: true, closed }, noStore);
  } catch {
    return fail("unavailable", 503);
  }
}
