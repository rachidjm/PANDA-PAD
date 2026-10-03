import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgGetReferrer } from "@/lib/db/referrals";
import { pgIsLegacyFeeWallet } from "@/lib/db/fee-tier";
import { PANDA_FEE_BPS, PANDA_REFERRED_FEE_BPS } from "./constants";

/**
 * The trading fee bps that actually applies to `wallet` right now — never a flat constant. Half price
 * (PANDA_REFERRED_FEE_BPS), for life, once either is true:
 *   - the wallet is bound to a recruiter (src/lib/db/referrals.ts's `referrals` table — however it got bound:
 *     a long `?ref=` link, a short `/r/<code>` link, or typed in by hand later, doesn't matter, it's the same
 *     permanent binding);
 *   - the wallet already traded on PANDA before the two-tier system shipped (legacy_fee_wallets, a frozen
 *     snapshot — see scripts/backfill-legacy-fee-wallets.ts).
 * Otherwise the default (PANDA_FEE_BPS). Never throws: any failure (no DB configured, a query hiccup) falls
 * back to the default rate — the SAME direction fee-transfer.ts's recruiterShare already fails in, so a
 * transient problem can only ever charge the ordinary rate, never silently undercharge.
 */
export async function feeBpsForWallet(wallet: string): Promise<number> {
  try {
    const db = getDb();
    const [referrer, legacy] = await Promise.all([pgGetReferrer(db, wallet), pgIsLegacyFeeWallet(db, wallet)]);
    return referrer || legacy ? PANDA_REFERRED_FEE_BPS : PANDA_FEE_BPS;
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return PANDA_FEE_BPS;
    console.error("[PANDA fee-tier] couldn't determine fee tier, using the default rate", wallet, err);
    return PANDA_FEE_BPS;
  }
}
