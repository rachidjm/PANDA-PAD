import { getDb } from "@/lib/db/client";
import { pgIsFounder, pgLiveRankOfInvitee } from "@/lib/db/referrals";
import { activeCutoffDay, bpsForRank, FOUNDER_SHARE_BPS } from "./tiers-config";

export * from "./tiers-config";

/**
 * Marginal commission tiers, by an invitee's LIVE rank among their recruiter's currently-active invitees (not a
 * number stored once — see the module doc on `referrals.firstActivatedAt` in src/lib/db/schema.ts for why a live
 * count is the only reading that satisfies both "tier is fixed by arrival order" and "when someone deactivates,
 * everyone after them moves up, never down"). A Founder (src/lib/db/referrals.ts's `pgIsFounder`) always gets
 * FOUNDER_SHARE_BPS flat, skipping rank entirely — reserving a Founder slot is itself the reward.
 *
 * Server-only (imports the database) — the pure tier math/config lives in ./tiers-config, safe for client use too.
 */

/** Whether `wallet` holds a Founder slot (reserved or minted — either counts). */
export async function isFounder(wallet: string): Promise<boolean> {
  return pgIsFounder(getDb(), wallet);
}

/**
 * The recruiter's live commission share (bps of PANDA's own trade fee, not of the trade) for a trade BY `invitee`.
 * Never throws — any failure (no DB configured, a query hiccup) propagates to the caller exactly like any other
 * "couldn't determine a referrer" case in src/lib/pump/fee-transfer.ts, which already treats that as "no
 * commission this trade", never a reason the trade itself could fail.
 */
export async function commissionBpsFor(referrer: string, invitee: string, now: number = Date.now()): Promise<number> {
  const db = getDb();
  if (await pgIsFounder(db, referrer)) return FOUNDER_SHARE_BPS;
  const rank = await pgLiveRankOfInvitee(db, referrer, invitee, activeCutoffDay(now));
  return bpsForRank(rank);
}
