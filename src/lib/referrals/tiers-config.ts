import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Pure config/logic only — no database import — so this is safe to use from a CLIENT component (the Recruiters
 * page's own static tier table) as well as the server (src/lib/referrals/tiers.ts, src/lib/config/env.ts,
 * src/lib/legal-content.ts). The live, DB-backed rank lookup itself lives in tiers.ts, which imports from here.
 */

export type Tier = { upTo: number | null; bps: number };

export const DEFAULT_REFERRAL_TIERS: Tier[] = [
  { upTo: 500, bps: 3000 }, // 1st–500th active invitee: 30%
  { upTo: 1500, bps: 2500 }, // 501st–1,500th: 25%
  { upTo: null, bps: 2000 }, // 1,501st+: 20%
];

export const FOUNDER_SHARE_BPS = 3000;

/** Parses and validates a REFERRAL_TIERS JSON string, or null if it isn't well-formed: an array of
 *  `{upTo, bps}` (upTo a positive integer or null, bps an integer 0-10,000), strictly ascending by `upTo`, with
 *  exactly one entry — the last — having `upTo: null` as the catch-all. Shared by `referralTiers` (lenient,
 *  falls back to the default) and src/lib/config/env.ts's strict validator (reports invalid, doesn't guess). */
function parseReferralTiersJson(raw: string): Tier[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const tiers: Tier[] = parsed.map((t: { upTo?: unknown; bps?: unknown }) => ({
      upTo: t.upTo === null || t.upTo === undefined ? null : Number(t.upTo),
      bps: Number(t.bps),
    }));
    const lastIsCatchAll = tiers[tiers.length - 1].upTo === null;
    const shapeOk =
      lastIsCatchAll && tiers.every((t, i) => Number.isInteger(t.bps) && t.bps >= 0 && t.bps <= 10_000 && (t.upTo === null ? i === tiers.length - 1 : Number.isInteger(t.upTo) && t.upTo > 0));
    const ascending = tiers.every((t, i) => i === 0 || t.upTo === null || (tiers[i - 1].upTo !== null && t.upTo > (tiers[i - 1].upTo as number)));
    return shapeOk && ascending ? tiers : null;
  } catch {
    return null;
  }
}

/** REFERRAL_TIERS as JSON (`[{"upTo":500,"bps":3000},...,{"upTo":null,"bps":2000}]`) — any parse/shape problem
 *  falls back to DEFAULT_REFERRAL_TIERS whole, never a partially-trusted value. */
export function referralTiers(env: Record<string, string | undefined> = process.env): Tier[] {
  if (!env.REFERRAL_TIERS) return DEFAULT_REFERRAL_TIERS;
  return parseReferralTiersJson(env.REFERRAL_TIERS) ?? DEFAULT_REFERRAL_TIERS;
}

/** Strict version for src/lib/config/env.ts's own validation (reports a problem instead of silently falling back). */
export function isValidReferralTiersJson(raw: string): boolean {
  return parseReferralTiersJson(raw) !== null;
}

/** First matching tier's bps — tiers must be sorted ascending by `upTo` with a final `upTo: null` catch-all (both DEFAULT_REFERRAL_TIERS and referralTiers()'s validation guarantee this). */
export function bpsForRank(rank: number, tiers: Tier[] = referralTiers()): number {
  for (const tier of tiers) {
    if (tier.upTo === null || rank <= tier.upTo) return tier.bps;
  }
  return tiers[tiers.length - 1]?.bps ?? 0;
}

export const DEFAULT_FOUNDER_REQUIRED_TRADERS = 10;

/** How many "valid" invitees (src/lib/referrals/founder.ts) a recruiter needs before a Founder slot is earned —
 *  a valid invitee is one who traded at least founderMinTraderVolumeUsd() of their own volume (anti-abuse is
 *  already guaranteed for every bound invitee by construction, see src/lib/referrals/bind.ts). */
export function founderRequiredTraders(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.FOUNDER_REQUIRED_TRADERS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_FOUNDER_REQUIRED_TRADERS;
}

export const DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD = 100;

/** The cumulative USD volume (buys + sells, each valued at its own historical SOL/USD price) an invitee needs
 *  before they count toward their recruiter's Founder-slot progress. */
export function founderMinTraderVolumeUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.FOUNDER_MIN_TRADER_VOLUME_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FOUNDER_MIN_TRADER_VOLUME_USD;
}

export const DEFAULT_REFERRAL_MIN_DAILY_VOLUME_SOL = 0.05;

/** The daily volume (in lamports) an invitee needs for a UTC day to count toward their 3-day streak. */
export function referralMinDailyVolumeLamports(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.REFERRAL_MIN_DAILY_VOLUME_SOL);
  const sol = Number.isFinite(n) && n > 0 ? n : DEFAULT_REFERRAL_MIN_DAILY_VOLUME_SOL;
  return Math.round(sol * LAMPORTS_PER_SOL);
}

const MS_PER_DAY = 86_400_000;
/** Active window: a streak holder is still "active" as long as the gap since their last qualifying day hasn't
 *  reached 3 full days — i.e. their lastQualifyingDay is no older than 2 days ago. Exported so both the DB layer
 *  (src/lib/db/referrals.ts's live-rank query) and the UI (a plain read, no query) use the exact same cutoff. */
export function activeCutoffDay(now: number = Date.now()): string {
  return new Date(now - 2 * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isCurrentlyActive(state: { lastQualifyingDay: string | null; streakAtLastQualifyingDay: number }, now: number = Date.now()): boolean {
  return state.streakAtLastQualifyingDay >= 3 && state.lastQualifyingDay !== null && state.lastQualifyingDay >= activeCutoffDay(now);
}
