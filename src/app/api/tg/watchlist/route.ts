import { NextResponse } from "next/server";
import { appUnwatch, appWatch, appWatchlist } from "@/lib/telegram/miniapp";
import { appDeps, appFail, appGate, noStore } from "@/lib/telegram/miniapp-route";

/** The same watchlist as the bot's /watch, /unwatch and /watchlist — one list per Telegram account. */
export async function GET(req: Request) {
  const g = await appGate(req);
  if (g instanceof NextResponse) return g;
  return NextResponse.json({ items: await appWatchlist(appDeps(), g.telegramId) }, noStore);
}

export async function POST(req: Request) {
  const g = await appGate(req, 30);
  if (g instanceof NextResponse) return g;
  const body = (await req.json().catch(() => null)) as { mint?: unknown } | null;
  const r = await appWatch(appDeps(), g.telegramId, body?.mint);
  return r.ok ? NextResponse.json(r, noStore) : appFail(r);
}

export async function DELETE(req: Request) {
  const g = await appGate(req, 30);
  if (g instanceof NextResponse) return g;
  const body = (await req.json().catch(() => null)) as { mint?: unknown } | null;
  const r = await appUnwatch(appDeps(), g.telegramId, body?.mint);
  return r.ok ? NextResponse.json(r, noStore) : appFail(r);
}
