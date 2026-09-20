import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { fileAppeal } from "@/lib/abuse/store";
import { recordAudit } from "@/lib/audit/log";

/**
 * Auth: a signed-in wallet session — a wallet can only appeal its own restriction.
 * Body: { message } (20–1000 characters). Only RESTRICTED / DISQUALIFIED wallets can appeal,
 * one open appeal at a time. A person reads it; nothing changes automatically.
 * Gated by the PANDA_POINTS feature flag.
 */
export async function POST(req: Request) {
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const wallet = getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (rateLimited(`appeal:${wallet}`, 10, 3_600_000) || rateLimited(`appeal:ip:${clientIp(req)}`, 20, 3_600_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const b = await req.json().catch(() => null);
  if (!b || typeof b.message !== "string") return NextResponse.json({ error: "Write your appeal first." }, { status: 400 });

  try {
    const r = await fileAppeal(wallet, b.message, Date.now());
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await recordAudit({ req, actor: wallet, action: "abuse.appeal.open", object: wallet, newState: { appealId: r.id } });
    return NextResponse.json({ ok: true, appealId: r.id });
  } catch {
    return NextResponse.json({ error: "Couldn't send your appeal — try again." }, { status: 500 });
  }
}
