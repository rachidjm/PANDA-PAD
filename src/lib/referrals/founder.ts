import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgCountValidInvitees, pgGetReferrer, pgIsFounder, pgReserveFounderSlot } from "@/lib/db/referrals";
import { pgCumulativeTradeVolumeUsd } from "@/lib/db/trades";
import { founderMinTraderVolumeUsd, founderRequiredTraders } from "./tiers-config";
import { isEnabled } from "@/lib/config/flags";

/**
 * Founder-slot progress: a recruiter earns one of the 1,000 permanent slots once founderRequiredTraders() of
 * their invitees are each "valid" — their OWN cumulative trade volume has reached founderMinTraderVolumeUsd()
 * (anti-abuse needs no separate check here: every bound invitee already passed it at bind time, by
 * construction — see src/lib/referrals/bind.ts's tryBindReferral, the only path that ever writes a `referrals`
 * row). Called once per confirmed trade (src/app/api/portfolio/record-trade), for the wallet that just traded —
 * never the referrer directly, since it's the INVITEE's own volume that counts regardless of who referred them.
 *
 * Cheap on every normal trade: only does any real work the one time a wallet's cumulative volume crosses the
 * threshold for the first time ("justCrossed", mirroring streak.ts's own pattern) — every trade before or long
 * after that moment is a single read that returns immediately. Best-effort and silent on failure — the trade
 * itself already happened; this only affects whether a Founder slot gets reserved, never the trade record.
 */
export async function recordFounderProgress(wallet: string, tradeUsd: number, now: number = Date.now()): Promise<void> {
  if (!isEnabled("FOUNDER_NFT") || !(tradeUsd > 0)) return;
  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return;
    throw err;
  }
  try {
    const threshold = founderMinTraderVolumeUsd();
    const totalAfter = await pgCumulativeTradeVolumeUsd(db, wallet);
    const totalBefore = totalAfter - tradeUsd;
    const justCrossed = totalAfter >= threshold && totalBefore < threshold;
    if (!justCrossed) return;

    const referrer = await pgGetReferrer(db, wallet);
    if (!referrer) return;
    if (await pgIsFounder(db, referrer)) return; // already a Founder — no need to recount

    const validCount = await pgCountValidInvitees(db, referrer, threshold);
    if (validCount >= founderRequiredTraders()) {
      await pgReserveFounderSlot(db, referrer, now);
    }
  } catch {
    // Bookkeeping only — see the module doc above.
  }
}
