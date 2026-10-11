import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { tgDeleteState, tgGetState, tgSetState } from "@/lib/db/telegram";
import { cleanRelayAnswer, isRelayId, miniappEnabled, relayKey, RELAY_TTL_MS, type RelaySlot } from "@/lib/telegram/miniapp";
import { appGate, noStore } from "@/lib/telegram/miniapp-route";

/**
 * The wallet relay (src/lib/telegram/miniapp.ts). POST opens a slot (signed-in Mini App), PUT fills it once (the page the
 * wallet app redirects to, in the phone's browser), GET reads it once (the same Telegram account that opened it). What
 * travels is the wallet's ENCRYPTED answer; the key to read it never leaves the Mini App.
 */
export async function POST(req: Request) {
  const g = await appGate(req, 30);
  if (g instanceof NextResponse) return g;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = body?.id;
  if (!isRelayId(id)) return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  const db = getDb();
  const now = Date.now();
  if (await tgGetState<RelaySlot>(db, relayKey(id))) return NextResponse.json({ error: "exists", code: "exists" }, { status: 409 });
  const slot: RelaySlot = { telegramId: g.telegramId, expiresAt: now + RELAY_TTL_MS, answer: null };
  await tgSetState(db, relayKey(id), slot, now);
  return NextResponse.json({ ok: true, expiresAt: slot.expiresAt }, noStore);
}

export async function PUT(req: Request) {
  if (!miniappEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`tg-relay:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; answer?: unknown } | null;
  const id = body?.id;
  const answer = cleanRelayAnswer(body?.answer);
  if (!isRelayId(id) || !answer) return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  const db = getDb();
  const now = Date.now();
  const slot = await tgGetState<RelaySlot>(db, relayKey(id));
  // Unknown, expired and already-filled slots all answer the same: nothing to learn by probing ids.
  if (!slot || slot.expiresAt <= now || slot.answer) return NextResponse.json({ error: "gone", code: "gone" }, { status: 410 });
  await tgSetState(db, relayKey(id), { ...slot, answer }, now);
  return NextResponse.json({ ok: true }, noStore);
}

export async function GET(req: Request) {
  const g = await appGate(req, 240);
  if (g instanceof NextResponse) return g;
  const id = new URL(req.url).searchParams.get("id");
  if (!isRelayId(id)) return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  const db = getDb();
  const slot = await tgGetState<RelaySlot>(db, relayKey(id));
  if (!slot || slot.telegramId !== g.telegramId) return NextResponse.json({ error: "gone", code: "gone" }, { status: 410 });
  if (slot.expiresAt <= Date.now()) {
    await tgDeleteState(db, relayKey(id));
    return NextResponse.json({ error: "gone", code: "gone" }, { status: 410 });
  }
  if (!slot.answer) return NextResponse.json({ pending: true }, noStore);
  await tgDeleteState(db, relayKey(id));
  return NextResponse.json({ answer: slot.answer }, noStore);
}
