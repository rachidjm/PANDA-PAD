import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sameOrigin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { appSessionOf, closeAppSession, startAppSession } from "@/lib/telegram/app-login";
import { appGate, noStore } from "@/lib/telegram/miniapp-route";

/**
 * PANDA's session inside the Mini App (src/lib/telegram/app-login.ts). Every call needs the Telegram session (appGate:
 * Telegram's signed data, checked); the wallet is always the one that account linked with /link, never one the request names.
 *   GET     is there a live session? (counts as a use)
 *   POST    sign in — no wallet signature: Telegram proves the account, the link gives the wallet.
 *   DELETE  sign out.
 */
const deps = () => ({ db: getDb(), now: Date.now });
const fail = (error: string, status: number) => NextResponse.json({ error, code: error }, { status, ...noStore });

export async function GET(req: Request) {
  const g = await appGate(req, 60, "login");
  if (g instanceof NextResponse) return g;
  try {
    const s = await appSessionOf(deps(), g.telegramId);
    return NextResponse.json({ active: !!s, wallet: s?.wallet ?? null, expiresAt: s?.expiresAt ?? null }, noStore);
  } catch {
    return fail("unavailable", 503);
  }
}

export async function POST(req: Request) {
  const g = await appGate(req, 20, "login");
  if (g instanceof NextResponse) return g;
  if (!sameOrigin(req)) return fail("invalid", 400);
  try {
    const r = await startAppSession(deps(), g.telegramId);
    if (!r.ok) return fail(r.error, 409);
    await recordAudit({ req, actor: r.wallet, action: "auth.login", object: "session", newState: { via: "telegram-miniapp", telegramId: g.telegramId } });
    return NextResponse.json({ active: true, wallet: r.wallet, expiresAt: r.expiresAt }, noStore);
  } catch {
    return fail("unavailable", 503);
  }
}

export async function DELETE(req: Request) {
  const g = await appGate(req, 20, "login");
  if (g instanceof NextResponse) return g;
  try {
    return NextResponse.json({ ok: true, closed: await closeAppSession(deps(), g.telegramId) }, noStore);
  } catch {
    return fail("unavailable", 503);
  }
}
