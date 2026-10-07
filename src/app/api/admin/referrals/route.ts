import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgListInvitees, pgSearchReferralAttemptLog } from "@/lib/db/referrals";

/**
 * Auth: admin. "Referidos" search: `q` (a code or a wallet/referrer address — searches every attempt ever
 * logged, bound or not, see src/lib/db/schema.ts's referral_attempt_log) and/or `referrer` (every wallet that
 * recruiter has actually bound, same list /reclutadores itself reads). Either, both, or neither (recent attempts).
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) || undefined;
  const referrer = url.searchParams.get("referrer")?.trim() || undefined;

  try {
    const db = getDb();
    const [attempts, invitees] = await Promise.all([pgSearchReferralAttemptLog(db, { q, limit: 100 }), referrer ? pgListInvitees(db, referrer) : Promise.resolve(undefined)]);
    return NextResponse.json({ attempts, invitees }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ attempts: [], invitees: referrer ? [] : undefined });
    return NextResponse.json({ error: "Couldn't read the referrals log right now." }, { status: 500 });
  }
}
