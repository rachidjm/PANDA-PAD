"use client";

/**
 * Client-side half of the affiliate link: `?ref=<wallet>` is remembered (first one wins, in THIS browser) until
 * the connected wallet's first real sign-in, when useWalletSession.ts sends it to /api/auth/verify. The server
 * has the only real say (self-referral, the campaign window, the anti-abuse check — see src/lib/referrals/bind.ts);
 * this is just "don't forget what was in the URL before the wallet extension popup steals focus".
 */

const KEY = "panda:ref";
const CODE_KEY = "panda:pending-code";
/** A little looser than a strict base58 pubkey regex (never trusted as one until the server re-validates it) — just enough to not store obvious junk. */
const LOOKS_LIKE_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const WELCOME_SHOWN_KEY = "panda:ref-welcome-shown";
const WELCOME_PENDING_KEY = "panda:ref-welcome-pending";

/** Arms the one-time "you came in through a recruiter" toast (see ReferralWelcomeBanner) for the wallet that
 *  was JUST captured — never if the toast has already been shown once, ever, in this browser. */
function armWelcomeToast(referrer: string): void {
  try {
    if (window.localStorage.getItem(WELCOME_SHOWN_KEY)) return;
    window.localStorage.setItem(WELCOME_PENDING_KEY, referrer);
  } catch {
    // Nothing to recover — worst case the toast just doesn't show this visit.
  }
}

export function captureReferralFromUrl(): void {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref || !LOOKS_LIKE_ADDRESS.test(ref)) return;
    if (!window.localStorage.getItem(KEY)) {
      window.localStorage.setItem(KEY, ref); // first link wins, even client-side
      armWelcomeToast(ref);
    }
  } catch {
    // Private window, blocked storage, ... — the referral simply isn't remembered this visit.
  }
}

/** A short recruiter code carried in the URL — how a code typed before connecting survives the trip into the
 *  Phantom app's in-app browser (a different browser storage, so localStorage alone can't carry it across). */
export function captureCodeFromUrl(): void {
  try {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code || code.length > 20) return;
    if (!window.localStorage.getItem(CODE_KEY)) window.localStorage.setItem(CODE_KEY, code);
  } catch {
    // Same as above — nothing to recover, just not remembered this visit.
  }
}

/** A PANDA-launched coin's own page doubles as its creator's recruiter link — same "first wins, never
 *  overwritten client-side" rule as an explicit `?ref=` link. Called from the coin page on mount
 *  (src/components/coin/CoinClient.tsx) only when `coin.launchedOnPanda` is true. */
export function capturePandaLaunchReferral(creator: string): void {
  try {
    if (!LOOKS_LIKE_ADDRESS.test(creator)) return;
    if (!window.localStorage.getItem(KEY)) {
      window.localStorage.setItem(KEY, creator);
      armWelcomeToast(creator);
    }
  } catch {
    // Same as above — nothing to recover, just not remembered this visit.
  }
}

/** The wallet a pending "you just got referred" welcome toast should name, or null if none is pending —
 *  consumed exactly once (see ReferralWelcomeBanner): calling this clears it and permanently marks the toast
 *  as shown, so it is never armed again even across browser restarts. */
export function consumePendingWelcome(): string | null {
  try {
    const wallet = window.localStorage.getItem(WELCOME_PENDING_KEY);
    if (!wallet) return null;
    window.localStorage.removeItem(WELCOME_PENDING_KEY);
    window.localStorage.setItem(WELCOME_SHOWN_KEY, "1");
    return wallet;
  } catch {
    return null;
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

/**
 * A recruiter's short code, typed in by hand (the "¿Tienes un código de referido?" field in the disconnected
 * wallet menu — src/components/WalletButton.tsx) before any wallet is even connected yet. Same "remembered
 * until the next real sign-in, server has the only real say" contract as `pendingReferrer` above — see
 * useWalletSession.ts, which sends this alongside `ref` to /api/auth/verify and clears it once that call
 * reaches a terminal outcome (bound, or rejected for good).
 */
export function setPendingCode(code: string): void {
  try {
    window.localStorage.setItem(CODE_KEY, code);
  } catch {
    // Private window, blocked storage — the code just isn't remembered this visit.
  }
}

export function pendingCode(): string | null {
  try {
    return window.localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingCode(): void {
  try {
    window.localStorage.removeItem(CODE_KEY);
  } catch {
    // Nothing to do — worst case it's offered again next sign-in and the server says whatever it says.
  }
}
