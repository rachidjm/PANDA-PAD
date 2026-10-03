import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgAddDailyVolume, pgCountLiveActive, pgGetReferralStreak, pgGetReferrer, pgSetReferralStreak } from "@/lib/db/referrals";
import { activeCutoffDay, referralMinDailyVolumeLamports } from "./tiers";
import { alertOps } from "@/lib/alerts";

/**
 * The "trader active" streak: a UTC day counts toward it once a referred wallet's OWN volume that day reaches
 * REFERRAL_MIN_DAILY_VOLUME_SOL. 3 consecutive counting days → active (and `firstActivatedAt` is fixed, once,
 * forever — see schema.ts). `isActive` itself is never stored (src/lib/referrals/tiers.ts computes it live from
 * `lastQualifyingDay`), so deactivation after 3 quiet days needs nothing more than reading the row later — no
 * cron sweep required for a wallet that simply stops trading.
 */

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nextDay = (day: string) => dayOf(Date.parse(`${day}T00:00:00Z`) + 86_400_000);

/** Alert PANDA (never cut anything) the moment a recruiter's live active-invitee count crosses a tier boundary. */
const ACTIVE_ALERT_THRESHOLDS = [500, 1500];

/**
 * Called once per confirmed trade (src/app/api/portfolio/record-trade) for the wallet that just traded. No-op for
 * a wallet with no referrer, or when Postgres isn't configured. Best-effort and silent on any other failure — the
 * trade itself already happened; this only affects tomorrow's commission tier, never today's trade.
 */
export async function recordReferralVolumeAndStreak(wallet: string, tradeLamports: number, now: number = Date.now()): Promise<void> {
  if (!(tradeLamports > 0)) return;
  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return;
    throw err;
  }
  try {
    const referrer = await pgGetReferrer(db, wallet);
    if (!referrer) return;

    const today = dayOf(now);
    const total = await pgAddDailyVolume(db, wallet, today, tradeLamports);
    const threshold = referralMinDailyVolumeLamports();
    const justCrossed = total >= threshold && total - tradeLamports < threshold;
    if (!justCrossed) return;

    const state = (await pgGetReferralStreak(db, wallet)) ?? { lastQualifyingDay: null, streakAtLastQualifyingDay: 0, firstActivatedAt: null };
    if (state.lastQualifyingDay === today) return; // already extended today — shouldn't happen given justCrossed, kept as a belt-and-suspenders guard

    const consecutive = state.lastQualifyingDay !== null && nextDay(state.lastQualifyingDay) === today;
    const newStreak = consecutive ? state.streakAtLastQualifyingDay + 1 : 1;
    const justActivated = newStreak >= 3 && state.firstActivatedAt === null;
    const firstActivatedAt = state.firstActivatedAt ?? (newStreak >= 3 ? now : null);

    await pgSetReferralStreak(db, wallet, { lastQualifyingDay: today, streakAtLastQualifyingDay: newStreak, firstActivatedAt });

    if (justActivated) {
      const activeCount = await pgCountLiveActive(db, referrer, activeCutoffDay(now));
      if (ACTIVE_ALERT_THRESHOLDS.includes(activeCount)) {
        await alertOps("referrals.active_tier_crossed", { referrer, activeCount }).catch(() => {});
      }
    }
  } catch {
    // Bookkeeping only — see the module doc above.
  }
}
