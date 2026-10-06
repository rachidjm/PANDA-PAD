import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgInviteeEarnings, pgInviteeVolumesUsd, pgListInvitees, pgListReferralAttempts } from "@/lib/db/referrals";
import { activeCutoffDay, isCurrentlyActive } from "@/lib/referrals/tiers-config";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type InviteeState = "bound" | "pending" | "rejected";

/** Public, read-only: EVERY wallet `referrer` has brought in — bound ones with their live trader-active streak and
 *  their own volume, plus pending/rejected attempts (no volume, no streak, no earnings). Never filters out an
 *  invitee for not having traded yet. `rejected` never says why (the anti-abuse reason stays server-side). */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`referrals-invitees:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    let db;
    try {
      db = getDb();
    } catch (err) {
      if (err instanceof DbNotConfiguredError) return NextResponse.json({ invitees: [] });
      throw err;
    }
    const [rows, attempts, earnings, volumesUsd] = await Promise.all([
      pgListInvitees(db, wallet),
      pgListReferralAttempts(db, wallet),
      pgInviteeEarnings(db, wallet),
      pgInviteeVolumesUsd(db, wallet),
    ]);
    const now = Date.now();
    const cutoff = activeCutoffDay(now);
    const bound = rows.map((r) => ({
      wallet: r.wallet,
      state: "bound" as InviteeState,
      boundAt: r.boundAt,
      source: r.source,
      code: r.source === "code" ? r.code : null,
      active: isCurrentlyActive(r, now),
      everActivated: r.firstActivatedAt !== null,
      // The streak as it stands TODAY: a streak whose last counting day is older than the active window has lapsed.
      streakDays: r.lastQualifyingDay !== null && r.lastQualifyingDay >= cutoff ? Math.min(3, r.streakAtLastQualifyingDay) : 0,
      earnedLamports: earnings[r.wallet] ?? 0,
      tradedVolumeUsd: volumesUsd[r.wallet] ?? 0,
    }));
    const notBound = attempts.map((a) => ({
      wallet: a.wallet,
      state: a.status as InviteeState,
      boundAt: a.updatedAt,
      source: a.source,
      code: a.source === "code" ? a.code : null,
      active: false,
      everActivated: false,
      streakDays: 0,
      earnedLamports: 0,
      tradedVolumeUsd: 0,
    }));
    return NextResponse.json({ invitees: [...bound, ...notBound] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read your invitees right now." }, { status: 500 });
  }
}
