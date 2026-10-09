import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { telegramConfig } from "@/lib/telegram/config";
import { linkMessageFor } from "@/lib/telegram/link";

/** Public (the /link code is the credential). Body: { code, wallet, replace }. Returns the exact message the wallet must sign. */
export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg.enabled) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`tg-link:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { code?: unknown; wallet?: unknown; replace?: unknown } | null;
  const r = await linkMessageFor(getDb(), { code: body?.code, wallet: body?.wallet, replace: body?.replace === true, domain: cfg.domain, now: Date.now() });
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.error }, { status: r.error === "invalid" ? 400 : 410 });
  return NextResponse.json({ message: r.message }, { headers: { "Cache-Control": "no-store" } });
}
