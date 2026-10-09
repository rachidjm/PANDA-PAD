import { NextResponse } from "next/server";
import { clearSessionCookie, copySessionCookie, renewSession, revokeCurrentSession, sameOrigin } from "@/lib/auth/session";

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Auth: the caller's own session cookie. Called by the browser while the site is in use (SessionKeeper): a normal wallet's
 * session is pushed 7 days forward (at most once an hour, no new signature); an admin's 2-hour session is left as it is.
 * If the cookie belongs to a DIFFERENT wallet than the one connected now, that session is ended (switching wallet signs out).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { wallet?: unknown } | null;
  const wallet = typeof body?.wallet === "string" && WALLET_RE.test(body.wallet) ? body.wallet : null;
  if (!wallet) return NextResponse.json({ error: "Invalid wallet." }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  const result = await renewSession(req, res, wallet);
  if (result === "other_wallet") {
    await revokeCurrentSession(req, "wallet_changed");
    const out = NextResponse.json({ ok: true, result: "signed_out" });
    clearSessionCookie(out);
    out.headers.set("Cache-Control", "no-store");
    return out;
  }
  const out = NextResponse.json({ ok: true, result });
  copySessionCookie(res, out);
  out.headers.set("Cache-Control", "no-store");
  return out;
}
