import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgGetWalletByCode } from "@/lib/db/fee-tier";
import { normalizeRecruiterCode } from "@/lib/referrals/codes";

/** Public, read-only: does a recruiter's short code exist? Asked by the "¿Tienes un código de referido?" modal
 *  before the wallet connects. Answers only yes/no — the same thing an /r/<code> link already reveals. */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  const raw = new URL(req.url).searchParams.get("code") ?? "";
  if (!raw.trim() || raw.length > 40) return NextResponse.json({ valid: false }, { headers: { "Cache-Control": "no-store" } });
  if (await rateLimited(`referrals-check-code:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const owner = await pgGetWalletByCode(getDb(), normalizeRecruiterCode(raw));
    return NextResponse.json({ valid: owner !== null }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ error: "Can't check codes right now." }, { status: 503 });
    return NextResponse.json({ error: "Can't check codes right now." }, { status: 502 });
  }
}
