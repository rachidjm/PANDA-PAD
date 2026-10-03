import { PublicKey } from "@solana/web3.js";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgBindReferral, pgCountBoundInvitees, pgGetReferrer, pgReserveFounderSlot } from "@/lib/db/referrals";
import { pgGetWalletByCode } from "@/lib/db/fee-tier";
import { pgHasAnyTrade } from "@/lib/db/trades";
import { normalizeRecruiterCode } from "./codes";
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
  if (!bound) return "already_bound"; // lost a race to a concurrent sign-in

  // Founder slots (src/lib/db/schema.ts's founderAllocations): the first 1,000 recruiters to land their very
  // first-ever bound invitee get one, for free, for life. Best-effort — a failure here must never undo or fail
  // the bind itself (the invitee is already real and permanent regardless of whether a Founder slot exists).
  if (isEnabled("FOUNDER_NFT")) {
    try {
      if ((await pgCountBoundInvitees(db, referrerCandidate)) === 1) {
        await pgReserveFounderSlot(db, referrerCandidate, Date.now());
      }
    } catch (err) {
      console.error("[PANDA founder] slot reservation failed", referrerCandidate, err);
    }
  }

  return "bound";
}

/**
 * "invalid_code"    no recruiter owns that short code.
 * "already_traded"  this wallet already has at least one trade — a code can only be applied before the first one.
 * (every other outcome is exactly tryBindReferral's own — see above.)
 */
export type ApplyCodeOutcome = BindOutcome | "invalid_code" | "already_traded";

/** Whether `wallet` could still apply a recruiter code right now — no referrer yet AND no trade yet. Used to
 *  decide whether to even show the "have a code?" field/nudge, without exposing WHY if it can't (see route). */
export async function canApplyRecruiterCode(wallet: string): Promise<boolean> {
  if (!isEnabled("REFERRALS")) return false;
  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return false;
    throw err;
  }
  const [referrer, traded] = await Promise.all([pgGetReferrer(db, wallet), pgHasAnyTrade(db, wallet)]);
  return !referrer && !traded;
}

/** The manual "I have a code" flow (as opposed to a `?ref=` link): resolves the short code to its owner's wallet,
 *  then goes through the exact same binding rules as a link (self-referral, anti-abuse, Founder slot) via
 *  tryBindReferral — plus the one rule unique to this flow: a wallet that has already made a trade can never
 *  apply a code afterwards (it would retroactively change its fee rate and someone else's commission on trades
 *  that already happened). That check happens here, before resolving the code, so "already_traded" never
 *  depends on whether the typed code was even real. */
export async function tryApplyRecruiterCode(
  wallet: string,
  rawCode: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApplyCodeOutcome> {
  if (!isEnabled("REFERRALS")) return "rejected";

  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return "retry_later";
    throw err;
  }

  if (await pgGetReferrer(db, wallet)) return "already_bound";
  if (await pgHasAnyTrade(db, wallet)) return "already_traded";

  const referrer = await pgGetWalletByCode(db, normalizeRecruiterCode(rawCode));
  if (!referrer) return "invalid_code";

  return tryBindReferral(wallet, referrer, fetchImpl);
}
