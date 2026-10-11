import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sameOrigin } from "@/lib/auth/session";
import { siteUrl } from "@/lib/config/site";
import { rateLimited } from "@/lib/rate-limit";
import { createLinkCode } from "@/lib/telegram/link";
import { LINK_LIMIT, LINK_WINDOW_MS, linkPageUrl } from "@/lib/telegram/link-limit";
import { appGate, noStore } from "@/lib/telegram/miniapp-route";

/**
 * "Link my wallet", asked from inside the Mini App: the same one-time link the bot's /link gives, for the Telegram
 * account that Telegram's signed data names (appGate) — handed straight to the app, which opens the link page with
 * Telegram's own way of opening links. No message is sent to the bot. Same limit as /link: a few links per ten minutes.
 */
export async function POST(req: Request) {
  const g = await appGate(req, 20, "link");
  if (g instanceof NextResponse) return g;
  if (!sameOrigin(req)) return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400, ...noStore });
  if (await rateLimited(`tg:link:${g.telegramId}`, LINK_LIMIT, LINK_WINDOW_MS)) return NextResponse.json({ error: "rate", code: "rate", minutes: LINK_WINDOW_MS / 60_000 }, { status: 429, ...noStore });
  try {
    const { code, expiresAt } = await createLinkCode(getDb(), g.telegramId, Date.now());
    return NextResponse.json({ url: linkPageUrl(siteUrl(), code), expiresAt }, noStore);
  } catch {
    return NextResponse.json({ error: "unavailable", code: "unavailable" }, { status: 503, ...noStore });
  }
}
