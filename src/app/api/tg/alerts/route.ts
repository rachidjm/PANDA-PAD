import { NextResponse } from "next/server";
import { appAddAlert, appAlerts, appDeleteAlert } from "@/lib/telegram/miniapp";
import { appDeps, appFail, appGate, noStore } from "@/lib/telegram/miniapp-route";

/** The same price / market-cap alerts as the bot's /alert and /alerts; the bot sends the message when one fires. */
export async function GET(req: Request) {
  const g = await appGate(req);
  if (g instanceof NextResponse) return g;
  return NextResponse.json({ alerts: await appAlerts(appDeps(), g.telegramId) }, noStore);
}

export async function POST(req: Request) {
  const g = await appGate(req, 30);
  if (g instanceof NextResponse) return g;
  const body = (await req.json().catch(() => null)) as { mint?: unknown; metric?: unknown; direction?: unknown; value?: unknown } | null;
  const r = await appAddAlert(appDeps(), g.telegramId, { mint: body?.mint, metric: body?.metric, direction: body?.direction, value: body?.value });
  return r.ok ? NextResponse.json(r, noStore) : appFail(r);
}

export async function DELETE(req: Request) {
  const g = await appGate(req, 30);
  if (g instanceof NextResponse) return g;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const r = await appDeleteAlert(appDeps(), g.telegramId, body?.id);
  return r.ok ? NextResponse.json(r, noStore) : appFail(r);
}
