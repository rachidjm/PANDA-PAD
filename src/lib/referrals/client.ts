"use client";

/**
 * Client-side half of the affiliate link: `?ref=<wallet>` is remembered (first one wins, in THIS browser) until
 * the connected wallet's first real sign-in, when useWalletSession.ts sends it to /api/auth/verify. The server
 * has the only real say (self-referral, the campaign window, the anti-abuse check — see src/lib/referrals/bind.ts);
 * this is just "don't forget what was in the URL before the wallet extension popup steals focus".
 */

const KEY = "panda:ref";
/** A little looser than a strict base58 pubkey regex (never trusted as one until the server re-validates it) — just enough to not store obvious junk. */
const LOOKS_LIKE_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function captureReferralFromUrl(): void {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref || !LOOKS_LIKE_ADDRESS.test(ref)) return;
    if (!window.localStorage.getItem(KEY)) window.localStorage.setItem(KEY, ref); // first link wins, even client-side
  } catch {
    // Private window, blocked storage, ... — the referral simply isn't remembered this visit.
  }
}

/** A PANDA-launched coin's own page doubles as its creator's recruiter link — same "first wins, never
 *  overwritten client-side" rule as an explicit `?ref=` link. Called from the coin page on mount
 *  (src/components/coin/CoinClient.tsx) only when `coin.launchedOnPanda` is true. */
export function capturePandaLaunchReferral(creator: string): void {
  try {
    if (!LOOKS_LIKE_ADDRESS.test(creator)) return;
    if (!window.localStorage.getItem(KEY)) window.localStorage.setItem(KEY, creator);
  } catch {
    // Same as above — nothing to recover, just not remembered this visit.
  }
}

export function pendingReferrer(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingReferrer(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — worst case it's offered again next sign-in and the server says "already_bound".
  }
}
