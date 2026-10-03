import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgFounderSlotsTaken } from "@/lib/db/referrals";

/** Public, read-only, no wallet needed: how many of the 1,000 Founder slots are left — the logged-out hero's own counter. */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  if (await rateLimited(`referrals-founders:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    let taken = 0;
    try {
      taken = await pgFounderSlotsTaken(getDb());
    } catch (err) {
      if (!(err instanceof DbNotConfiguredError)) throw err;
    }
    return NextResponse.json({ slotsLeft: Math.max(0, 1000 - taken) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read Founder slots right now." }, { status: 500 });
  }
}
