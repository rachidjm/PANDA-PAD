import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgGetReferralAttempt, pgGetReferralBinding, pgOwnVolumeUsd } from "@/lib/db/referrals";
import { pgIsLegacyFeeWallet } from "@/lib/db/fee-tier";
import { activeCutoffDay, isCurrentlyActive, referredDiscountMinVolumeUsd } from "@/lib/referrals/tiers-config";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Public, read-only: the invitee's OWN referral status, for the "Te invitó @<código>" line and the
 *  "Código aplicado, verificando…" line in the wallet menu. `bound` (who invited it, through which code or link,
 *  when), `pending` (verification still in progress — retried automatically), or `none`. A rejection is
 *  deliberately reported as `none` to the invitee, same as "never referred". */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ state: "none" }, { headers: { "Cache-Control": "no-store" } });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`referrals-status:ip:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ state: "none" });
    throw err;
  }
  try {
    const bound = await pgGetReferralBinding(db, wallet);
    if (bound) {
      const [ownVolumeUsd, legacy] = await Promise.all([pgOwnVolumeUsd(db, wallet), pgIsLegacyFeeWallet(db, wallet)]);
      const discountMinVolumeUsd = referredDiscountMinVolumeUsd();
      const now = Date.now();
      return NextResponse.json(
        {
          state: "bound",
          referrer: bound.referrer,
          source: bound.source,
          code: bound.source === "code" ? bound.code : null,
          boundAt: bound.boundAt,
          // Whether THIS wallet pays the discounted rate right now (see src/lib/pump/fee-tier.ts) — a legacy
          // (grandfathered) wallet always does; a referred one does once its own volume crosses the threshold.
          discountActive: legacy || ownVolumeUsd >= discountMinVolumeUsd,
          ownVolumeUsd,
          discountMinVolumeUsd,
          active: isCurrentlyActive(bound, now),
          streakDays: bound.lastQualifyingDay !== null && bound.lastQualifyingDay >= activeCutoffDay(now) ? Math.min(3, bound.streakAtLastQualifyingDay) : 0,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const attempt = await pgGetReferralAttempt(db, wallet);
    if (attempt?.status === "pending") return NextResponse.json({ state: "pending" }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ state: "none" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read your referral status right now." }, { status: 500 });
  }
}
