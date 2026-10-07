import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit/log";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgGetReferralAttempt } from "@/lib/db/referrals";
import { tryBindReferral } from "@/lib/referrals/bind";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Auth: admin. Body: { wallet }. Re-runs the anti-abuse check for a wallet whose bind is still "pending" — the
 * SAME retry a later sign-in would have done on its own, just triggered by hand instead of waiting. Only ever
 * acts on a row genuinely still `pending`: a `rejected` one (self-funded, caught by the anti-abuse check) is
 * terminal by design and this refuses it outright, same as tryBindReferral always has — there is no "force
 * bind anyway" here. Every attempt is logged (src/lib/referrals/bind.ts), so the retry shows up in the same
 * search as the original one did.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet : null;
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });

  try {
    const db = getDb();
    const attempt = await pgGetReferralAttempt(db, wallet);
    if (!attempt) return NextResponse.json({ error: "No pending attempt for this wallet." }, { status: 404 });
    if (attempt.status !== "pending") {
      return NextResponse.json({ error: "This attempt was rejected by the anti-abuse check — it can't be retried." }, { status: 409 });
    }

    const outcome = await tryBindReferral(wallet, attempt.referrer, fetch, { source: attempt.source, code: attempt.code });
    await recordAudit({ req, actor: admin.wallet, action: "admin.retry_referral_bind", object: wallet, newState: { outcome, referrer: attempt.referrer } });
    return NextResponse.json({ wallet, outcome });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ error: "No database configured." }, { status: 503 });
    return NextResponse.json({ error: "Couldn't retry this bind right now." }, { status: 500 });
  }
}
