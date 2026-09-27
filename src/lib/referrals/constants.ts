/**
 * The affiliate campaign's own knobs — separate from FEATURE_REFERRALS (the kill switch): the flag can be on
 * with the campaign window closed (no referrer is ever paid then, see `campaignWindow`), but never the other
 * way around — a closed flag means none of this code runs at all, checked by every caller before it touches
 * these.
 */

export const DEFAULT_REFERRAL_SHARE_BPS = 3000; // 30% of PANDA's own trade fee (0.5%) = 0.15% of the trade

/** The referrer's share of PANDA's trade fee, in basis points of THAT FEE (not of the trade). */
export function referralShareBps(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.REFERRAL_SHARE_BPS);
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : DEFAULT_REFERRAL_SHARE_BPS;
}

export type CampaignWindow = { start: number; end: number } | null;

/** The campaign's [start, end) in epoch ms, or null if REFERRAL_START/REFERRAL_END is missing or unparseable — in which case nothing is ever paid (see `campaignActive`). */
export function campaignWindow(env: Record<string, string | undefined> = process.env): CampaignWindow {
  const start = Date.parse(env.REFERRAL_START ?? "");
  const end = Date.parse(env.REFERRAL_END ?? "");
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return { start, end };
}

/** Whether a referral fee is paid, or a NEW referred↔referrer link may be bound, right now. */
export function campaignActive(now: number = Date.now(), env: Record<string, string | undefined> = process.env): boolean {
  const w = campaignWindow(env);
  return !!w && now >= w.start && now < w.end;
}

/** Whole days left (0 once the last day has started), for the countdown on the Affiliates page. Null outside/without a campaign. */
export function daysLeft(now: number = Date.now(), env: Record<string, string | undefined> = process.env): number | null {
  const w = campaignWindow(env);
  if (!w || now < w.start || now >= w.end) return null;
  return Math.max(0, Math.ceil((w.end - now) / 86_400_000));
}
