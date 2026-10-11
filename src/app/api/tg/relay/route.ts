import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { tgDeleteState, tgGetState, tgSetState } from "@/lib/db/telegram";
import { isRelayId, leaveRelayAnswer, miniappEnabled, relayKey, RELAY_TTL_MS, type RelaySlot } from "@/lib/telegram/miniapp";
import { appGate, noStore } from "@/lib/telegram/miniapp-route";

/**
 * The wallet relay (src/lib/telegram/miniapp.ts). What travels is the wallet's ENCRYPTED answer; the key to read it never
 * leaves the Mini App.
 *   POST  the Mini App says "slot <id> is mine" (best effort: the phone may freeze it before this is sent).
 *   PUT   the page the wallet app comes back to (in the phone's browser) leaves the answer — once. It is accepted even
 *         if the POST never arrived: the id is a 192-bit secret that only the Mini App which made it knows.
 *   GET   the Mini App collects the answer (it stays until the slot expires, a few minutes). A slot that belongs to
 *         another Telegram account is never given.
 */
export async function POST(req: Request) {
  const g = await appGate(req, 60, "relay-open");
  if (g instanceof NextResponse) return g;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = body?.id;
  if (!isRelayId(id)) return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  const db = getDb();
  const now = Date.now();
  const slot = await tgGetState<RelaySlot>(db, relayKey(id));
  if (slot && slot.telegramId !== null && slot.telegramId !== g.telegramId) return NextResponse.json({ error: "exists", code: "exists" }, { status: 409 });
  // New, already this account's, or left by the wallet before this arrived: in every case it is this account's now.
  const mine: RelaySlot = { telegramId: g.telegramId, expiresAt: slot?.expiresAt ?? now + RELAY_TTL_MS, answer: slot?.answer ?? null };
  await tgSetState(db, relayKey(id), mine, now);
  return NextResponse.json({ ok: true, expiresAt: mine.expiresAt }, noStore);
}

export async function PUT(req: Request) {
  if (!miniappEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`tg-relay:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; answer?: unknown } | null;
  const r = await leaveRelayAnswer(getDb(), body?.id, body?.answer, Date.now());
  if (r === "invalid") return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  if (r === "gone") return NextResponse.json({ error: "gone", code: "gone" }, { status: 410 });
  return NextResponse.json({ ok: true }, noStore);
}

export async function GET(req: Request) {
  // A read every two seconds while the user is in the wallet app: its own, generous count.
  const g = await appGate(req, 120, "relay-read");
  if (g instanceof NextResponse) return g;
  const id = new URL(req.url).searchParams.get("id");
  if (!isRelayId(id)) return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  const db = getDb();
  const slot = await tgGetState<RelaySlot>(db, relayKey(id));
  // Nothing yet (the wallet hasn't answered, and the "it's mine" may not have arrived either): keep waiting.
  if (!slot) return NextResponse.json({ pending: true }, noStore);
  if (slot.telegramId !== null && slot.telegramId !== g.telegramId) return NextResponse.json({ pending: true }, noStore);
  if (slot.expiresAt <= Date.now()) {
    await tgDeleteState(db, relayKey(id));
    return NextResponse.json({ pending: true }, noStore);
  }
  if (!slot.answer) return NextResponse.json({ pending: true }, noStore);
  // Not removed on reading: coming back from the wallet, Telegram may open a second copy of the app, and whichever
  // copy is on screen must find it. It is encrypted for a key only this phone holds, and gone when the slot expires.
  return NextResponse.json({ answer: slot.answer }, noStore);
}
