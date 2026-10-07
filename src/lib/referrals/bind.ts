import { PublicKey } from "@solana/web3.js";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgBindReferral, pgGetReferralAttempt, pgGetReferrer, pgLogReferralAttempt, pgUpsertReferralAttempt, type BindOrigin } from "@/lib/db/referrals";
import { pgGetWalletByCode } from "@/lib/db/fee-tier";
import { pgHasAnyTrade } from "@/lib/db/trades";
import { normalizeRecruiterCode } from "./codes";
import { firstFunderCheck } from "./anti-abuse";

/** Awaited by every caller (so it's already visible to a search the instant the request finishes), but never
 *  throws and never changes the real outcome: a logging hiccup must not turn a successful bind into a failed
 *  one. Every attempt — through a link, a typed code, successful or not — lands here, for /admin's own
 *  "Referidos" search (src/app/api/admin/referrals/route.ts) to answer "what actually happened for this code/wallet". */
async function logAttempt(row: { wallet: string | null; code: string | null; referrer: string | null; kind: "apply_code" | "sign_in"; result: string; reason?: string }): Promise<void> {
  try {
    await pgLogReferralAttempt(getDb(), row);
  } catch (err) {
    if (!(err instanceof DbNotConfiguredError)) console.error("[PANDA referrals] couldn't log an attempt", err);
  }
}

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
  fetchImpl: typeof fetch = fetch,
  origin: BindOrigin = { source: "link" }
): Promise<BindOutcome> {
  const kind = origin.source === "code" ? "apply_code" : "sign_in";
  const code = origin.source === "code" ? (origin.code ?? null) : null;
  const log = (result: string, reason?: string) => logAttempt({ wallet, code, referrer: referrerCandidate ?? null, kind, result, reason });

  if (!isEnabled("REFERRALS")) {
    await log("rejected", "referrals_off");
    return "rejected";
  }
  if (!referrerCandidate || !isRealAddress(referrerCandidate) || referrerCandidate === wallet) {
    await log("rejected", !referrerCandidate ? "no_referrer" : referrerCandidate === wallet ? "self_referral" : "invalid_referrer_address");
    return "rejected";
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) {
      await log("error", "no_database");
      return "retry_later";
    }
    throw err;
  }

  if (await pgGetReferrer(db, wallet)) {
    await log("already_bound");
    return "already_bound";
  }

  const now = Date.now();
  const funder = await firstFunderCheck(wallet, referrerCandidate, fetchImpl);
  // Not a binding yet, but the recruiter should still see the invitee (see referralAttempts in schema.ts). A
  // retry_later attempt is picked up again automatically on the invitee's next sign-in; a rejected one is final.
  if (funder === "unknown" || funder === "self_funded") {
    await pgUpsertReferralAttempt(db, {
      wallet,
      referrer: referrerCandidate,
      source: origin.source,
      code: origin.source === "code" ? (origin.code ?? null) : null,
      status: funder === "unknown" ? "pending" : "rejected",
      updatedAt: now,
    });
    await log(funder === "unknown" ? "pending" : "rejected", funder === "unknown" ? "anti_abuse_check_inconclusive" : "self_funded");
    return funder === "unknown" ? "retry_later" : "rejected";
  }

  const bound = await pgBindReferral(db, wallet, referrerCandidate, now, origin);
  if (!bound) {
    await log("already_bound", "lost_race_to_concurrent_sign_in");
    return "already_bound"; // lost a race to a concurrent sign-in
  }

  // Founder slots (src/lib/db/schema.ts's founderAllocations) are no longer triggered by binding itself — a
  // freshly-bound invitee hasn't traded yet, so they can't make a recruiter cross the valid-invitee threshold.
  // See src/lib/referrals/founder.ts, called from the trade-confirmation route instead.
  await log("bound");
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
  const [referrer, traded, attempt] = await Promise.all([pgGetReferrer(db, wallet), pgHasAnyTrade(db, wallet), pgGetReferralAttempt(db, wallet)]);
  // A code already in progress (pending verification) is shown as its own status line, never as a fresh field.
  return !referrer && !traded && !(attempt && attempt.status === "pending");
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
  const normalizedForLog = normalizeRecruiterCode(rawCode);
  const log = (result: string, reason?: string) => logAttempt({ wallet, code: normalizedForLog, referrer: null, kind: "apply_code", result, reason });

  if (!isEnabled("REFERRALS")) {
    await log("rejected", "referrals_off");
    return "rejected";
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) {
      await log("error", "no_database");
      return "retry_later";
    }
    throw err;
  }

  if (await pgGetReferrer(db, wallet)) {
    await log("already_bound");
    return "already_bound";
  }
  if (await pgHasAnyTrade(db, wallet)) {
    await log("rejected", "already_traded");
    return "already_traded";
  }

  const code = normalizeRecruiterCode(rawCode);
  const referrer = await pgGetWalletByCode(db, code);
  if (!referrer) {
    await log("invalid_code");
    return "invalid_code";
  }

  // tryBindReferral logs its own outcome (it knows the resolved referrer, this function doesn't duplicate it).
  return tryBindReferral(wallet, referrer, fetchImpl, { source: "code", code });
}
