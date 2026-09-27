import { PublicKey } from "@solana/web3.js";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgBindReferral, pgGetReferrer } from "@/lib/db/referrals";
import { campaignActive } from "./constants";
import { firstFunderCheck } from "./anti-abuse";

/**
 * "bound"           a brand-new referral link was created.
 * "already_bound"   this wallet already has a referrer (this call, or a concurrent one, changes nothing).
 * "rejected"         invalid referrer, self-referral, the campaign isn't running right now, or the anti-abuse
 *                    check found the referred wallet's first SOL came from the referrer — TERMINAL: the caller
 *                    should stop offering this referrer for this wallet.
 * "retry_later"      the anti-abuse check couldn't be completed this time (no Helius, a network hiccup) — the
 *                    caller should try again on a later sign-in, not treat this as resolved.
 */
export type BindOutcome = "bound" | "already_bound" | "rejected" | "retry_later";

const isRealAddress = (v: string): boolean => {
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
};

/**
 * Attempts to bind `wallet` (just proved it owns its keys — see /api/auth/verify) to `referrerCandidate` (an
 * untrusted address the client read back from its own `?ref=` link). Every check that can reject the bind
 * happens BEFORE the database write, and the write itself is a single conflict-safe INSERT (see
 * pgBindReferral) — so of two concurrent sign-ins for the same never-before-seen wallet, exactly one wins,
 * never both, never a silently overwritten referrer.
 */
export async function tryBindReferral(
  wallet: string,
  referrerCandidate: string | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<BindOutcome> {
  if (!isEnabled("REFERRALS")) return "rejected";
  if (!referrerCandidate || !isRealAddress(referrerCandidate) || referrerCandidate === wallet) return "rejected";
  if (!campaignActive()) return "rejected"; // "Solo se pueden vincular invitados dentro de la campaña"

  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return "retry_later";
    throw err;
  }

  if (await pgGetReferrer(db, wallet)) return "already_bound";

  const funder = await firstFunderCheck(wallet, referrerCandidate, fetchImpl);
  if (funder === "unknown") return "retry_later";
  if (funder === "self_funded") return "rejected";

  const bound = await pgBindReferral(db, wallet, referrerCandidate, Date.now());
  return bound ? "bound" : "already_bound"; // lost a race to a concurrent sign-in
}
