import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgInviteeEarnings, pgInviteeVolumesUsd, pgListInvitees } from "@/lib/db/referrals";
import { isCurrentlyActive } from "@/lib/referrals/tiers";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Public, read-only: `referrer`'s own invitees, each with a live status (active / inactive / still on its way
 *  to 3 days) and what PANDA has verified was earned from that invitee specifically. */
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
    const [rows, earnings, volumesUsd] = await Promise.all([pgListInvitees(db, wallet), pgInviteeEarnings(db, wallet), pgInviteeVolumesUsd(db, wallet)]);
    const now = Date.now();
    const invitees = rows.map((r) => ({
      wallet: r.wallet,
      boundAt: r.boundAt,
      active: isCurrentlyActive(r, now),
      everActivated: r.firstActivatedAt !== null,
      streakDays: r.streakAtLastQualifyingDay,
      earnedLamports: earnings[r.wallet] ?? 0,
      tradedVolumeUsd: volumesUsd[r.wallet] ?? 0,
    }));
    return NextResponse.json({ invitees }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read your invitees right now." }, { status: 500 });
  }
}
